const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');
const report = require('gatsby-cli/lib/reporter');
const deepEqual = require('deep-equal');

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

    browser.on('result', content => {
      if (Array.isArray(content.hits)) {
        content.hits.forEach(hit => {
          hits[hit.objectID] = hit;
        });
      }
    });
    browser.on('end', () => resolve(hits));
    browser.on('error', err => reject(err));
  });
}

exports.onPostBuild = async function ({ graphql }, config) {
  const {
    appId,
    apiKey,
    queries,
    concurrentQueries = true,
    skipIndexing = false,
  } = config;

  const activity = report.activityTimer(`index to Algolia`);
  activity.start();

  if (skipIndexing === true) {
    setStatus(activity, `options.skipIndexing is true; skipping indexing`);
    activity.end();
    return;
  }

  const client = algoliasearch(appId, apiKey, { timeout: 30_000 });

  setStatus(activity, `${queries.length} queries to index`);

  try {
    // combine queries with the same index to prevent overwriting data
    const groupedQueries = groupQueriesByIndex(queries, config);

    const jobs = [];
    for (const [indexName, indexQueries] of Object.entries(groupedQueries)) {
      const queryPromise = runIndexQueries(indexName, indexQueries, {
        client,
        activity,
        graphql,
        config,
      });

      if (concurrentQueries) {
        jobs.push(queryPromise);
      } else {
        // await each individual query rather than batching them
        const res = await queryPromise;
        jobs.push(res);
      }
    }

    await Promise.all(jobs);
  } catch (err) {
    report.panic('failed to index to Algolia', err);
  }

  activity.end();
};

function groupQueriesByIndex(queries = [], config) {
  const { indexName: mainIndexName } = config;

  return queries.reduce((groupedQueries, queryOptions) => {
    const { indexName = mainIndexName } = queryOptions;

    return {
      ...groupedQueries,
      [indexName]: [
        ...(groupedQueries.hasOwnProperty(indexName)
          ? groupedQueries[indexName]
          : []),
        queryOptions,
      ],
    };
  }, {});
}

/**
 * Run all queries for a given index, then make any updates / removals necessary
 */
async function runIndexQueries(
  indexName,
  queries = [],
  { client, activity, graphql, config }
) {
  const {
    settings: mainSettings,
    chunkSize = 1000,
    enablePartialUpdates = false,
    matchFields: mainMatchFields = ['modified'],
  } = config;

  setStatus(
    activity,
    `Running ${queries.length} ${
      queries.length === 1 ? 'query' : 'queries'
    } for index ${indexName}...`
  );

  const objectMapsByQuery = await Promise.all(
    queries.map(query => getObjectsMapByQuery(query, graphql))
  );

  const allObjectsMap = objectMapsByQuery.reduce((acc, objectsMap = {}) => {
    return {
      ...acc,
      ...objectsMap,
    };
  }, {});

  setStatus(
    activity,
    `${queries.length === 1 ? 'Query' : 'Queries'} resulted in a total of ${
      Object.keys(allObjectsMap).length
    } results`
  );

  const index = client.initIndex(indexName);
  const tempIndex = client.initIndex(`${indexName}_tmp`);
  const indexToUse = await getIndexToUse({
    index,
    tempIndex,
    enablePartialUpdates,
  });

  let toIndex = {}; // used to track objects that should be added / updated
  const toRemove = {}; // used to track objects that are stale and should be removed

  if (enablePartialUpdates !== true) {
    // enablePartialUpdates isn't true, so index all objects
    toIndex = { ...allObjectsMap };
  } else {
    // iterate over each query to determine which data are fresh
    setStatus(activity, `Starting Partial updates...`);

    // get all match fields for all queries to minimize calls to the api
    const allMatchFields = getAllMatchFields(queries, mainMatchFields);

    // get all indexed objects matching all matched fields
    const indexedObjects = await fetchAlgoliaObjects(
      indexToUse,
      allMatchFields
    );

    // iterate over each query
    for (const [i, { matchFields = mainMatchFields }] of queries.entries()) {
      const queryResultsMap = objectMapsByQuery[i] || {};

      // iterate over existing objects and compare to fresh data
      for (const [id, existingObj] of Object.entries(indexedObjects)) {
        if (queryResultsMap.hasOwnProperty(id)) {
          // key matches fresh objects, so compare match fields
          const newObj = queryResultsMap[id];
          if (!matchFields.every(field => newObj.hasOwnProperty(field))) {
            report.panic(
              'when enablePartialUpdates is true, the objects must have at least one of the match fields. Current object:\n' +
                JSON.stringify(newObj, null, 2) +
                '\n' +
                'expected one of these fields:\n' +
                matchFields.join('\n')
            );
          }

          if (matchFields.some(field => !deepEqual(existingObj[field], newObj[field], { strict: true }))) {
            // one or more fields differ, so index new object
            toIndex[id] = newObj;
          } else {
            // objects are the same, so skip
          }

          // remove from queryResultsMap, since it is already accounted for
          delete queryResultsMap[id];
        } else {
          // check if existing object exists in any new query
          if (!allObjectsMap.hasOwnProperty(id)) {
            // existing object not in new queries; remove
            toRemove[id] = true;
          }
        }
      }

      if (Object.values(queryResultsMap).length) {
        // stale objects have been removed, remaining query objects should be indexed
        toIndex = {
          ...toIndex,
          ...queryResultsMap,
        };
      }
    }
  }

  const objectsToIndex = Object.values(toIndex);
  const objectsToRemove = Object.keys(toRemove);

  if (objectsToIndex.length) {
    const chunks = chunk(objectsToIndex, chunkSize);

    setStatus(
      activity,
      `Found ${objectsToIndex.length} new / updated records...`
    );

    if (chunks.length > 1) {
      setStatus(activity, `Splitting in ${chunks.length} jobs`);
    }

    /* Add changed / new objects */
    const chunkJobs = chunks.map(async function (chunked) {
      const { taskID } = await indexToUse.addObjects(chunked);
      return indexToUse.waitTask(taskID);
    });

    await Promise.all(chunkJobs);
  } else {
    setStatus(activity, `No updates necessary; skipping!`);
  }

  if (objectsToRemove.length) {
    setStatus(
      activity,
      `Found ${objectsToRemove.length} stale objects; removing...`
    );

    const { taskID } = await indexToUse.deleteObjects(objectsToRemove);
    await indexToUse.waitTask(taskID);
  }

  // defer to first query for index settings
  // todo: maybe iterate over all settings and throw if they differ
  const { settings = mainSettings, forwardToReplicas } = queries[0] || {};

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
    await moveIndex(client, indexToUse, index);
  }

  setStatus(activity, 'Done!');
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
    .catch(error => {
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
    console.log('[Algolia]', status);
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

async function getSettingsToApply({ settings, index, tempIndex, indexToUse }) {
  const existingSettings = await index.getSettings().catch(e => {
    report.panic(`${e.toString()} ${index.indexName}`);
  });

  if (!settings) {
    return existingSettings;
  }

  const replicasToSet = getReplicasToSet(
    settings.replicas,
    existingSettings.replicas,
    settings.replicaUpdateMode
  );

  const { replicaUpdateMode, ...requestedSettings } = {
    ...settings,
    replicas: replicasToSet,
  };

  // If we're building replicas, we don't want to add them to temporary indices
  if (indexToUse === tempIndex) {
    const { replicas, ...adjustedSettings } = requestedSettings;
    return adjustedSettings;
  }

  return requestedSettings;
}

function getReplicasToSet(
  givenReplicas = [],
  existingReplicas = [],
  replicaUpdateMode = 'merge'
) {
  if (replicaUpdateMode == 'replace') {
    return givenReplicas;
  }

  if (replicaUpdateMode === 'merge') {
    const replicas = new Set();
    existingReplicas.forEach(replica => replicas.add(replica));
    givenReplicas.forEach(replica => replicas.add(replica));

    return [...replicas];
  }
}

async function getObjectsMapByQuery({ query, transformer }, graphql) {
  const result = await graphql(query);
  if (result.errors) {
    report.panic(
      `failed to index to Algolia, errors:\n ${JSON.stringify(result.errors)}`,
      result.errors
    );
  }

  const objects = (await transformer(result)).map(object => ({
    objectID: object.objectID || object.id,
    ...object,
  }));

  if (objects.length > 0 && !objects[0].objectID) {
    report.panic(
      `failed to index to Algolia. Query results do not have 'objectID' or 'id' key`
    );
  }

  // return a map by id for later use
  return Object.fromEntries(objects.map(object => [object.objectID, object]));
}

// get all match fields for all queries to minimize calls to the api
function getAllMatchFields(queries, mainMatchFields = []) {
  const allMatchFields = new Set(mainMatchFields);

  queries.forEach(({ matchFields = [] }) => {
    matchFields.forEach(field => {
      allMatchFields.add(field);
    });
  });

  return [...allMatchFields];
}

async function createIndex(index) {
  const { taskID } = await index.setSettings({});
  await index.waitTask(taskID);
  return index;
}
