const algoliasearch = require('algoliasearch');
const chunk = require('lodash.chunk');

exports.onPostBuild = function(
  { graphql },
  { appId, apiKey, queries, chunkSize = 1000 }
) {
  const client = algoliasearch(appId, apiKey);

  const jobs = queries.map(
    async function doQuery({ indexName, query, transformer }) {
      const index = client.initIndex(indexName);
      const result = await graphql(query);
      const objects = transformer(result);
      const chunks = chunk(objects, chunkSize);

      const chunkJobs = chunks.map(async function(chunked) {
        const { taskID } = await index.addObjects(chunked);
        return index.waitTask(taskID);
      });

      return Promise.all(chunkJobs);
    }
  );

  return Promise.all(jobs);
};
