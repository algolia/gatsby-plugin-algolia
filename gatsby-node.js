const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');
const deepEqual = require('deep-equal');

/**
 * Fetches all records for the current index from Algolia
 *
 * @param {AlgoliaIndex} index eg. client.initIndex('your_index_name');
 * @param {Array<String>} attributesToRetrieve eg. ['modified', 'slug']
 */
function fetchAlgoliaObjects(
  index,
  attributesToRetrieve = ['modified'],
  reporter
) {
  const hits = {};

  return index
    .browseObjects({
      batch: batch => {
        if (Array.isArray(batch)) {
          batch.forEach(hit => {
            hits[hit.objectID] = hit;
          });
        }
      },
      attributesToRetrieve,
    })
    .then(() => hits)
    .catch(err =>
      reporter.panicOnBuild('failed while getting indexed objects', err)
    );
}

exports.onPostBuild = async function ({ graphql, reporter }, config) {
  const {
    appId,
    apiKey,
    queries,
    concurrentQueries = true,
    skipIndexing = false,
    dryRun = false,
    continueOnFailure = false,
  } = config;

  const activity = reporter.activityTimer(`index to Algolia`);
  activity.start();

  if (skipIndexing === true) {
    activity.setStatus(`options.skipIndexing is true; skipping indexing`);
    activity.end();
    return;
  }

  if (dryRun === true) {
    console.log(
      '\x1b[33m%s\x1b[0m',
      '==== THIS IS A DRY RUN ====================\n' +
        '- No records will be pushed to your index\n' +
        '- No settings will be updated on your index'
    );
  }

  if (continueOnFailure === true && !(appId && apiKey)) {
    activity.setStatus(`options.continueOnFailure is true and api key or appId are missing; skipping indexing`);
    activity.end();
    return;
  }

  const client = algoliasearch(appId, apiKey, {
    timeouts: {
      connect: 1,
      read: 30,
      write: 30,
    },
  });

  activity.setStatus(`${queries.length} queries to index`);

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
        reporter,
        dryRun,
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
    if (continueOnFailure) {
      reporter.warn('failed to index to Algolia');
      console.error(err);
    } else {
      activity.panicOnBuild('failed to index to Algolia', err);
    }
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
 * @param {string} indexName
 * @param {string[]} queries
 * @param {object} options
 * @param {import('algoliasearch').SearchClient} options.client
 * @param {any} options.activity
 * @param {any} options.graphql
 * @param {any} options.reporter
 * @param {any} options.config
 * @param {boolean=} options.dryRun
 */
async function runIndexQueries(
  indexName,
  queries = [],
  { client, activity, graphql, reporter, config, dryRun }
) {
  const {
    settings: mainSettings,
    chunkSize = 1000,
    enablePartialUpdates = false,
    matchFields: mainMatchFields = ['modified'],
  } = config;

  activity.setStatus(
    `Running ${queries.length} ${
      queries.length === 1 ? 'query' : 'queries'
    } for index ${indexName}...`
  );

  const objectMapsByQuery = await Promise.all(
    queries.map(query => getObjectsMapByQuery(query, graphql, reporter))
  );

  const allObjectsMap = objectMapsByQuery.reduce((acc, objectsMap = {}) => {
    return {
      ...acc,
      ...objectsMap,
    };
  }, {});

  activity.setStatus(
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
    activity.setStatus(`Starting Partial updates...`);

    // get all match fields for all queries to minimize calls to the api
    const allMatchFields = getAllMatchFields(queries, mainMatchFields);

    // get all indexed objects matching all matched fields
    const indexedObjects = await fetchAlgoliaObjects(
      indexToUse,
      allMatchFields,
      reporter
    );

    // iterate over each query
    for (const [i, { matchFields = mainMatchFields }] of queries.entries()) {
      const queryResultsMap = objectMapsByQuery[i] || {};

      // iterate over existing objects and compare to fresh data
      for (const [id, existingObj] of Object.entries(indexedObjects)) {
        if (queryResultsMap.hasOwnProperty(id)) {
          // key matches fresh objects, so compare match fields
          const newObj = queryResultsMap[id];
          if (
            matchFields.every(field => newObj.hasOwnProperty(field) === false)
          ) {
            reporter.panicOnBuild(
              'when enablePartialUpdates is true, the objects must have at least one of the match fields. Current object:\n' +
                JSON.stringify(newObj, null, 2) +
                '\n' +
                'expected one of these fields:\n' +
                matchFields.join('\n')
            );
          }

          if (
            matchFields.some(
              field =>
                !deepEqual(existingObj[field], newObj[field], { strict: true })
            )
          ) {
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

    activity.setStatus(
      `Found ${objectsToIndex.length} new / updated records...`
    );

    if (chunks.length > 1) {
      activity.setStatus(`Splitting in ${chunks.length} jobs`);
    }

    /* Add changed / new objects */
    const chunkJobs = chunks.map(async function (chunked) {
      if (dryRun === true) {
        reporter.info(`Records to add: ${objectsToIndex.length}`);
      } else {
        await indexToUse.saveObjects(chunked);
      }
    });

    await Promise.all(chunkJobs);
  } else {
    activity.setStatus(`No updates necessary; skipping!`);
  }

  if (objectsToRemove.length) {
    activity.setStatus(
      `Found ${objectsToRemove.length} stale objects; removing...`
    );

    if (dryRun === true) {
      reporter.info(`Records to delete: ${objectsToRemove.length}`);
    } else {
      await indexToUse.deleteObjects(objectsToRemove).wait();
    }
  }

  // defer to first query for index settings
  // todo: maybe iterate over all settings and throw if they differ
  const { settings = mainSettings, forwardToReplicas } = queries[0] || {};

  const settingsToApply = await getSettingsToApply({
    settings,
    index,
    tempIndex,
    indexToUse,
    reporter,
  });

  if (dryRun) {
    console.log('[dry run]: settings', settingsToApply);
  } else {
    await indexToUse
      .setSettings(settingsToApply, {
        forwardToReplicas,
      })
      .wait();
  }

  if (dryRun) {
    console.log('[dry run]: settings', settingsToApply);
  } else {
    await indexToUse
      .setSettings(settingsToApply, {
        forwardToReplicas,
      })
      .wait();
  }

  if (indexToUse === tempIndex && dryRun === false) {
    await moveIndex(client, indexToUse, index);
  }

  activity.setStatus('Done!');
}

/**
 * moves the source index to the target index
 * @param client
 * @param sourceIndex
 * @param targetIndex
 * @return {Promise}
 */
async function moveIndex(client, sourceIndex, targetIndex) {
  // first copy the rules and synonyms to the temporary index, as we don't want
  // to touch the original index, and there's no way to only move objects and
  // settings, leaving rules and synonyms in place.
  await client.copyIndex(targetIndex.indexName, sourceIndex.indexName, {
    scope: ['rules', 'synonyms'],
  });

  return client.moveIndex(sourceIndex.indexName, targetIndex.indexName).wait();
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
 * @param {object} options
 * @param {import('algoliasearch').SearchIndex} options.index
 * @param {import('algoliasearch').SearchIndex} options.tempIndex
 * @param {boolean=} options.enablePartialUpdates
 * @returns {Promise<import('algoliasearch').SearchIndex>}
 */
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

/**
 * @param {object} options
 * @param {import('@algolia/client-search').Settings} options.settings
 * @param {import('algoliasearch').SearchIndex} options.index
 * @param {import('algoliasearch').SearchIndex} options.tempIndex
 * @param {import('algoliasearch').SearchIndex} options.indexToUse
 * @param {any} options.reporter
 * @returns {import('@algolia/client-search').Settings}
 */
async function getSettingsToApply({
  settings,
  index,
  tempIndex,
  indexToUse,
  reporter,
}) {
  const existingSettings = await index.getSettings().catch(e => {
    reporter.panicOnBuild(`${e.toString()} ${index.indexName}`);
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

async function getObjectsMapByQuery({ query, transformer }, graphql, reporter) {
  const result = await graphql(query);
  if (result.errors) {
    reporter.panicOnBuild(
      `failed to index to Algolia, errors:\n ${JSON.stringify(result.errors)}`,
      result.errors
    );
  }

  const objects = (await transformer(result)).map(object => ({
    objectID: object.objectID || object.id,
    ...object,
  }));

  if (objects.length > 0 && !objects[0].objectID) {
    reporter.panicOnBuild(
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
  await index.setSettings({}).wait();
  return index;
}
