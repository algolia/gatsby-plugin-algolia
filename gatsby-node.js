const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');

/**
 * give back the same thing as this was called with.
 *
 * @param {any} obj what to keep the same
 */
const identity = obj => obj;

exports.onPostBuild = function(
  { graphql },
  { appId, apiKey, queries, indexName: mainIndexName, chunkSize = 1000 }
) {
  const client = algoliasearch(appId, apiKey);

  const jobs = queries.map(async function doQuery({
    indexName = mainIndexName,
    query,
    transformer = identity,
  }) {
    const index = client.initIndex(indexName);
    const result = await graphql(query);
    const objects = transformer(result);
    const chunks = chunk(objects, chunkSize);

    const chunkJobs = chunks.map(async function(chunked) {
      const { taskID } = await index.addObjects(chunked);
      return index.waitTask(taskID);
    });

    return Promise.all(chunkJobs);
  });

  return Promise.all(jobs);
};
