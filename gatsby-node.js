const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');
const report = require('gatsby-cli/lib/reporter');

/**
 * give back the same thing as this was called with.
 *
 * @param {any} obj what to keep the same
 */
const identity = (obj) => obj;

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
        content.hits.forEach((hit) => {
          hits[hit.objectID] = hit;
        });
      }
    });
    browser.on('end', () => resolve(hits));
    browser.on('error', (err) => reject(err));
  });
}

exports.onPostBuild = async function (
  { graphql },
  {
    appId,
    apiKey,
    queries,
    settings: mainSettings,
    indexName: mainIndexName,
    chunkSize = 1000,
    enablePartialUpdates = false,
    matchFields: mainMatchFields = ['modified'],
  }
) {
  const activity = report.activityTimer(`index to Algolia`);
  activity.start();

  const client = algoliasearch(appId, apiKey);

  setStatus(activity, `${queries.length} queries to index`);

  const indexState = {};

  const jobs = queries.map(async function doQuery(
    {
      indexName = mainIndexName,
      query,
      transformer = identity,
      settings = mainSettings,
      forwardToReplicas,
      matchFields = mainMatchFields,
    },
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
    const tempIndex = client.initIndex(`${indexName}_tmp`);
    const indexToUse = await getIndexToUse({
      index,
      tempIndex,
      enablePartialUpdates,
    });

    /* Use to keep track of what to remove afterwards */
    if (!indexState[indexName]) {
      indexState[indexName] = {
        index,
        toRemove: {},
      };
    }
    const currentIndexState = indexState[indexName];

    setStatus(activity, `query #${i + 1}: executing query`);
    const result = await graphql(query);
    if (result.errors) {
      report.panic(`failed to index to Algolia`, result.errors);
    }

    const objects = (await transformer(result)).map((object) => ({
      objectID: object.objectID || object.id,
      ...object,
    }));

    if (objects.length > 0 && !objects[0].objectID) {
      report.panic(
        `failed to index to Algolia. Query results do not have 'objectID' or 'id' key`
      );
    }

    setStatus(
      activity,
      `query ${i}: graphql resulted in ${Object.keys(objects).length} records`
    );

    let hasChanged = objects;
    let algoliaObjects = {};
    if (enablePartialUpdates) {
      setStatus(activity, `query ${i}: starting Partial updates`);

      algoliaObjects = await fetchAlgoliaObjects(indexToUse, matchFields);

      const nbMatchedRecords = Object.keys(algoliaObjects).length;
      setStatus(
        activity,
        `query ${i}: found ${nbMatchedRecords} existing records`
      );

      if (nbMatchedRecords) {
        hasChanged = objects.filter((curObj) => {
          const ID = curObj.objectID;
          let extObj = algoliaObjects[ID];

          /* The object exists so we don't need to remove it from Algolia */
          delete algoliaObjects[ID];
          delete currentIndexState.toRemove[ID];

          if (!extObj) return true;

          return !!matchFields.find((field) => extObj[field] !== curObj[field]);
        });

        Object.keys(algoliaObjects).forEach(
          ({ objectID }) => (currentIndexState.toRemove[objectID] = true)
        );
      }

      setStatus(
        activity,
        `query ${i}: Partial updates – [insert/update: ${hasChanged.length}, total: ${objects.length}]`
      );
    }

    const chunks = chunk(hasChanged, chunkSize);

    setStatus(activity, `query ${i}: splitting in ${chunks.length} jobs`);

    /* Add changed / new objects */
    const chunkJobs = chunks.map(async function (chunked) {
      const { taskID } = await indexToUse.addObjects(chunked);
      return indexToUse.waitTask(taskID);
    });

    await Promise.all(chunkJobs);

    const settingsToApply = await getSettingsToApply({
      settings,
      index,
      tempIndex,
      indexToUse,
    });

    const { taskID } = await indexToUse.setSettings(settingsToApply, {
      forwardToReplicas,
    });

    await indexToUse.waitTask(taskID);

    if (indexToUse === tempIndex) {
      setStatus(activity, `query ${i}: moving copied index to main index`);
      return moveIndex(client, indexToUse, index);
    }
  });

  try {
    await Promise.all(jobs);

    if (enablePartialUpdates) {
      /* Execute once per index */
      /* This allows multiple queries to overlap */
      const cleanup = Object.keys(indexState).map(async function (indexName) {
        const state = indexState[indexName];
        const isRemoved = Object.keys(state.toRemove);

        if (isRemoved.length) {
          setStatus(
            activity,
            `deleting ${isRemoved.length} objects from ${indexName} index`
          );
          const { taskID } = await state.index.deleteObjects(isRemoved);
          return state.index.waitTask(taskID);
        }
      });

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
function indexExists(index) {
  return index
    .getSettings()
    .then(() => true)
    .catch((error) => {
      if (error.statusCode !== 404) {
        throw error;
      }

      return false;
    });
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

async function getIndexToUse({ index, tempIndex, enablePartialUpdates }) {
  const mainIndexExists = await indexExists(index);

  if (enablePartialUpdates && !mainIndexExists) {
    return createIndex(index);
  }

  if (!enablePartialUpdates && mainIndexExists) {
    return tempIndex;
  }

  return index;
}

async function getSettingsToApply({
  settings: givenSettings,
  index,
  tempIndex,
  indexToUse,
}) {
  const { replicaUpdateMode, ...settings } = givenSettings;
  var existingSettings = {};
  try {
    existingSettings = await index.getSettings();
  } catch (e) {
    report.error(`${e.toString()} ${index.indexName}`);
  }
  const replicasToSet = getReplicasToSet(
    settings.replicas,
    existingSettings.replicas,
    replicaUpdateMode
  );
  var requestedSettings = settings ? settings : existingSettings;

  // If we're building replicas, we don't want to add them to temporary indices
  if (indexToUse === tempIndex) {
    const { replicas, ...adjustedSettings } = requestedSettings;
    requestedSettings = adjustedSettings;
    if (replicasToSet)
      await index.setSettings({ replicas: replicasToSet }).catch((err) => {
        report.panic(`${err.toString()} ${replicasToSet}`);
      });
  }
  return requestedSettings;
}

function getReplicasToSet(givenReplicas, existingReplicas, replicaUpdateMode) {
  const obj = {};
  if (replicaUpdateMode == 'replace')
    return (
      (givenReplicas &&
        givenReplicas.filter((r) => r && typeof r == 'string')) ||
      []
    );
  if (!existingReplicas) return givenReplicas;
  if (!givenReplicas) return existingReplicas;

  for (const replica of existingReplicas)
    if (replica && typeof replica == 'string') obj[replica] = replica;
  for (const replica of givenReplicas)
    if (replica && typeof replica == 'string') obj[replica] = replica;
  return Object.keys(obj);
}

async function createIndex(index) {
  const { taskID } = await index.setSettings({});
  await index.waitTask(taskID);
  return index;
}
