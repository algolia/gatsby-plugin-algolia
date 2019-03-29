const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');
const report = require('gatsby-cli/lib/reporter');

/**
 * give back the same thing as this was called with.
 *
 * @param {any} obj what to keep the same
 */
const identity = obj => obj;

/**
 * Fetches all records for the current index from Algolia
 *
 * @param {AlgoliaIndex} index eg. client.initIndex('your_index_name');
 * @param {Array<String>} attributesToRetrieve eg. ['modified', 'slug']
 */
function fetchAlgoliaObjects(index, attributesToRetrieve = ['modified']) {
  return new Promise((resolve, reject) => {
    const browser = index.browseAll('', { attributesToRetrieve });
    const hits = {};

    browser.on('result', (content) => {
      if (Array.isArray(content.hits)) {
        content.hits.forEach(hit => {
          hits[hit.objectID] = hit
        })
      }
    });
    browser.on('end', () => resolve(hits) );
    browser.on('error', (err) => reject(err) );
  });
}

exports.onPostBuild = async function(
  { graphql },
  { appId, apiKey, queries, indexName: mainIndexName, chunkSize = 1000, enablePartialUpdates = false, matchFields: mainMatchFields = ['modified'] }
) {
  const activity = report.activityTimer(`index to Algolia`);
  activity.start();

  const client = algoliasearch(appId, apiKey);

  setStatus(activity, `${queries.length} queries to index`);

  const indexState = {}

  const jobs = queries.map(async function doQuery(
    { indexName = mainIndexName, query, transformer = identity, settings, matchFields = mainMatchFields },
    i
  ) {
    if (!query) {
      report.panic(
        `failed to index to Algolia. You did not give "query" to this query`
      );
    }
    if (!Array.isArray(matchFields) || !matchFields.length) {
      return report.panic(
        `failed to index to Algolia. Argument matchFields has to be an array of strings`
      );
    }

    const index = client.initIndex(indexName);
    /* Use temp index if main index already exists */
    let useTempIndex = false
    const indexToUse = await (async function(_index) {
      if (!enablePartialUpdates) {
        if (useTempIndex = await indexExists(_index)) {
          return client.initIndex(`${indexName}_tmp`);
        }
      }
      return _index
    })(index)

    /* Use to keep track of what to remove afterwards */
    if (!indexState[indexName]) indexState[indexName] = {
      index,
      toRemove: {}
    }
    const currentIndexState = indexState[indexName]

    setStatus(activity, `query ${i}: executing query`);
    const result = await graphql(query);
    if (result.errors) {
      report.panic(`failed to index to Algolia`, result.errors);
    }
    const objects = transformer(result);

    if (objects.length > 0 && !objects[0].objectID) {
      report.panic(
        `failed to index to Algolia. Query results do not have 'objectID' key`
      );
    }

    setStatus(activity, `query ${i}: graphql resulted in ${Object.keys(objects).length} records`);

    let hasChanged = objects;
    let algoliaObjects = {}
    if (enablePartialUpdates) {
      setStatus(activity, `query ${i}: starting Partial updates`);

      algoliaObjects = await fetchAlgoliaObjects(indexToUse, matchFields);

      const results = Object.keys(algoliaObjects).length
      setStatus(activity, `query ${i}: found ${results} existing records`);

      if (results) {
        hasChanged = objects.filter(curObj => {
          const ID = curObj.objectID
          let extObj = algoliaObjects[ID]

          /* The object exists so we don't need to remove it from Algolia */
          delete(algoliaObjects[ID]);
          delete(currentIndexState.toRemove[ID])

          if (!extObj) return true;

          return !!matchFields.find(field => extObj[field] !== curObj[field]);
        });

        Object.keys(algoliaObjects).forEach(({ objectID }) => currentIndexState.toRemove[objectID] = true)
      }

      setStatus(activity, `query ${i}: Partial updates – [insert/update: ${hasChanged.length}, total: ${objects.length}]`);
    }

    const chunks = chunk(hasChanged, chunkSize);

    setStatus(activity, `query ${i}: splitting in ${chunks.length} jobs`);

    /* Add changed / new objects */
    const chunkJobs = chunks.map(async function(chunked) {
      const { taskID } = await indexToUse.addObjects(chunked);
      return indexToUse.waitTask(taskID);
    });

    await Promise.all(chunkJobs);

    if (settings) {
      indexToUse.setSettings(settings);
    }

    if (useTempIndex) {
      setStatus(activity, `query ${i}: moving copied index to main index`);
      return moveIndex(client, indexToUse, index);
    }
  });

  try {
    await Promise.all(jobs)

    if (enablePartialUpdates) {
      /* Execute once per index */
      /* This allows multiple queries to overlap */
      const cleanup = Object.keys(indexState).map(async function(indexName) {
        const state = indexState[indexName];
        const isRemoved = Object.keys(state.toRemove);

        if (isRemoved.length) {
          setStatus(activity, `deleting ${isRemoved.length} object from ${indexName} index`);
          const { taskID } = await state.index.deleteObjects(isRemoved);
          return state.index.waitTask(taskID);
        }
      })

      await Promise.all(cleanup);
    }
  } catch (err) {
    report.panic(`failed to index to Algolia`, err);
  }
  activity.end();
};

/**
 * Copy the settings, synonyms, and rules of the source index to the target index
 * @param client
 * @param sourceIndex
 * @param targetIndex
 * @return {Promise}
 */
async function scopedCopyIndex(client, sourceIndex, targetIndex) {
  const { taskID } = await client.copyIndex(
    sourceIndex.indexName,
    targetIndex.indexName,
    ['settings', 'synonyms', 'rules']
  );
  return targetIndex.waitTask(taskID);
}

/**
 * moves the source index to the target index
 * @param client
 * @param sourceIndex
 * @param targetIndex
 * @return {Promise}
 */
async function moveIndex(client, sourceIndex, targetIndex) {
  const { taskID } = await client.moveIndex(
    sourceIndex.indexName,
    targetIndex.indexName
  );
  return targetIndex.waitTask(taskID);
}

/**
 * Does an Algolia index exist already
 *
 * @param index
 */
async function indexExists(index) {
  try {
    const { nbHits } = await index.search();
    return nbHits > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Hotfix the Gatsby reporter to allow setting status (not supported everywhere)
 *
 * @param {Object} activity reporter
 * @param {String} status status to report
 */
function setStatus(activity, status) {
  if (activity && activity.setStatus) {
    activity.setStatus(status);
  } else {
    console.log('Algolia:', status);
  }
}
