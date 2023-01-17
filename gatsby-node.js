const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');

/**
 * @typedef {import('gatsby').GatsbyCache} GatsbyCache
 */

/**
 * @typedef {import('gatsby').Reporter} Reporter
 */

/**
 * @typedef {import('algoliasearch').SearchIndex} SearchIndex
 */

/**
 * @typedef {import('gatsby').graphql} graphql
 */

/**
 * @typedef {import('@algolia/client-search').Settings} Settings
 */

/**
 * @typedef Query
 * @property {string} query The graphql query
 * @property {object=} queryVariables Allows you to use graphql query variables in the query
 * @property {Function} transformer transform the results of the query into objects. Likely `({ data }) => data.myProperty.nodes`
 * @property {string=} indexName index name for this query
 * @property {Settings} settings index settings for this query
 * @property {boolean=} mergeSettings defaults to false. Whether settings set in the index are overridden or persisted
 */

/**
 * Fetches all records for the current index from Algolia
 * @param {SearchIndex} index
 * @param {Reporter} reporter
 * @param {GatsbyCache} cache
 */
function fetchExistingObjects(index, reporter, cache) {
  const hits = {};

  return cache
    .get(`algolia-objects-${index.indexName}`)
    .then(values => {
      if (!values || Object.keys(values).length === 0) {
        throw new Error('cache actually failed');
      }
      return values;
    })
    .catch(() =>
      index
        .browseObjects({
          batch: batch => {
            if (Array.isArray(batch)) {
              batch.forEach(hit => {
                if (hit.internal?.contentDigest) {
                  hits[hit.objectID] = hit;
                }
              });
            }
          },
          attributesToRetrieve: ['internal.contentDigest'],
        })
        .then(() => hits)
        .catch(err =>
          reporter.panicOnBuild('failed while getting indexed objects', err)
        )
    );
}

/**
 * @typedef PluginConfiguration
 * @property {string} appId
 * @property {string} apiKey
 * @property {import('algoliasearch').AlgoliaSearchOptions} algoliasearchOptions
 * @property {Query[]} queries
 * @property {string} indexName
 * @property {boolean} concurrentQueries
 * @property {boolean} dryRun
 * @property {boolean} continueOnFailure
 */

exports.onPostBuild = async function (
  /** @type {{graphql: graphql, reporter: Reporter, cache: GatsbyCache}} */ {
    graphql,
    reporter,
    cache,
  },
  /** @type {PluginConfiguration} */ config
) {
  const {
    appId,
    apiKey,
    queries,
    concurrentQueries = true,
    dryRun = false,
    continueOnFailure = false,
    algoliasearchOptions = {
      timeouts: {
        connect: 1,
        read: 30,
        write: 30,
      },
    },
  } = config;

  const activity = reporter.activityTimer(`index to Algolia`);
  activity.start();

  if (dryRun === true) {
    console.log(
      '\x1b[33m%s\x1b[0m',
      '==== THIS IS A DRY RUN ====================\n' +
        '- No records will be pushed to your index\n' +
        '- No settings will be updated on your index'
    );
  }

  if (continueOnFailure === true && !(appId && apiKey)) {
    activity.setStatus(
      `options.continueOnFailure is true and api key or appId are missing; skipping indexing`
    );
    activity.end();
    return;
  }

  const client = algoliasearch(appId, apiKey, algoliasearchOptions);

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
        cache,
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

/**
 * @param {PluginConfiguration} config
 */
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
 * @param {object[]} queries
 * @param {object} options
 * @param {import('algoliasearch').SearchClient} options.client
 * @param {import('gatsby').ActivityTracker} options.activity
 * @param {graphql} options.graphql
 * @param {Reporter} options.reporter
 * @param {PluginConfiguration} options.config
 * @param {GatsbyCache} options.cache
 * @param {boolean=} options.dryRun
 */
async function runIndexQueries(
  indexName,
  queries = [],
  { client, activity, graphql, reporter, cache, config, dryRun }
) {
  const { settings: mainSettings, chunkSize = 1000 } = config;

  activity.setStatus('Getting existing objects');

  const index = await initIndex(client, indexName);

  // get all indexed objects matching all matched fields
  const indexedObjects = await fetchExistingObjects(index, reporter, cache);

  activity.setStatus(
    `Running ${queries.length} ${
      queries.length === 1 ? 'query' : 'queries'
    } for index ${indexName}...`
  );

  const objectMapsByQuery = await Promise.all(
    queries.map(query => getObjectsMapByQuery(query, graphql, reporter))
  );

  const allObjectsMap = objectMapsByQuery.reduce((acc, objectsMap = {}) => {
    return Object.assign(acc, objectsMap);
  }, {});

  cache.set(
    `algolia-objects-${indexName}`,
    Object.fromEntries(
      Object.entries(allObjectsMap).map(([objectID, object]) => [
        objectID,
        { internal: { contentDigest: object.internal?.contentDigest } },
      ])
    )
  );

  activity.setStatus(
    `${queries.length === 1 ? 'Query' : 'Queries'} resulted in a total of ${
      Object.keys(allObjectsMap).length
    } results`
  );

  let toIndex = {}; // used to track objects that should be added / updated
  const toRemove = {}; // used to track objects that are stale and should be removed

  // iterate over each query to determine which data are fresh
  activity.setStatus(`Starting Partial updates...`);

  // iterate over each query
  for (const [i] of queries.entries()) {
    const queryResultsMap = objectMapsByQuery[i] || {};

    // iterate over existing objects and compare to fresh data
    for (const [id, existingObj] of Object.entries(indexedObjects)) {
      if (queryResultsMap.hasOwnProperty(id)) {
        // key matches fresh objects, so compare match fields
        const newObj = queryResultsMap[id];
        if (!newObj.internal?.contentDigest) {
          reporter.panicOnBuild(
            'the objects must have internal.contentDigest. Current object:\n' +
              JSON.stringify(newObj, null, 2)
          );
        }

        if (
          existingObj.internal?.contentDigest !== newObj.internal.contentDigest
        ) {
          // contentDigest differs, so index new object
          toIndex[id] = newObj;
        }
        // objects are the same, so skip

        // remove from queryResultsMap, since it is already accounted for
        delete queryResultsMap[id];
      } else {
        // remove existing object if it is managed and not returned from a query
        if (
          // not in any query
          !allObjectsMap.hasOwnProperty(id) &&
          // managed by this plugin
          existingObj.internal?.contentDigest
        ) {
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
        reporter.info(`[dry run]: ${objectsToIndex.length} records to add`);
      } else {
        await index.saveObjects(chunked);
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
      reporter.info(`[dry run]: ${objectsToRemove.length} records to delete`);
    } else {
      await index.deleteObjects(objectsToRemove).wait();
    }
  }

  // defer to first query for index settings
  // todo: maybe iterate over all settings and throw if they differ
  const {
    settings = mainSettings,
    mergeSettings = false,
    forwardToReplicas,
  } = queries[0] || {};

  const settingsToApply = await getSettingsToApply({
    settings,
    mergeSettings,
    index,
    reporter,
  });

  if (dryRun) {
    console.log('[dry run]: settings', settingsToApply);
  } else {
    await index
      .setSettings(settingsToApply, {
        forwardToReplicas,
      })
      .wait();
  }

  activity.setStatus('Done!');
}

/**
 * Does an Algolia index exist already
 * @param {import('algoliasearch').SearchIndex} index
 */
function indexExists(index) {
  return index
    .getSettings()
    .then(() => true)
    .catch(error => {
      if (error.status !== 404) {
        throw error;
      }

      return false;
    });
}

/**
 * @param {object} options
 * @param {Settings} options.settings
 * @param {boolean} options.mergeSettings
 * @param {import('algoliasearch').SearchIndex} options.index
 * @param {Reporter} options.reporter
 * @returns {Promise<Settings>}
 */
async function getSettingsToApply({
  settings,
  mergeSettings,
  index,
  reporter,
}) {
  const /** @type Settings */ existingSettings =
      await index.getSettings().catch(e => {
        reporter.panicOnBuild(`${e.toString()} ${index.indexName}`);
      });

  if (!settings) {
    return existingSettings;
  }

  return {
    ...(mergeSettings ? existingSettings : {}),
    ...settings,
  };
}

/**
 * @param {Query} options
 * @param {graphql} graphql
 * @param {Reporter} reporter
 */
async function getObjectsMapByQuery(
  { query, queryVariables, transformer = x => x },
  graphql,
  reporter
) {
  const result = await graphql(query, queryVariables);
  if (result.errors) {
    reporter.panicOnBuild(
      `failed to index to Algolia, errors:\n ${JSON.stringify(result.errors)}`,
      result.errors
    );
  }

  const objects = (await transformer(result)).map(object => ({
    objectID: object.id,
    ...object,
  }));

  if (objects.length > 0 && !objects[0].objectID) {
    reporter.panicOnBuild(
      `failed to index to Algolia. Query does not have 'id'`
    );
  }

  // return a map by id for later use
  return Object.fromEntries(objects.map(object => [object.objectID, object]));
}

/**
 * @param {algoliasearch.SearchClient} client
 * @param {string} indexName
 */
async function initIndex(client, indexName) {
  const index = client.initIndex(indexName);

  if (!(await indexExists(index))) {
    await index.setSettings({}).wait();
  }

  return index;
}
