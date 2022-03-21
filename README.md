# Gatsby plugin Algolia

> This plugin is in _beta_ and not officially supported yet
>
> Feel free to open issues for any questions or ideas

You can specify a list of queries to run and how to transform them into an array of objects to index. When you run `gatsby build`, it will publish those to Algolia.

<div align="center">
  <a
    href="https://mermaid-js.github.io/mermaid-live-editor/edit##eyJjb2RlIjoiZ3JhcGggTFJcbiAgICBBW1NvdXJjZSAxXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBCW1NvdXJjZSAyXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBDW1NvdXJjZSAzXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBcbiAgICBHYXRzYnkgLS0-IHxnYXRzYnkgYnVpbGR8IEFsZ29saWEiLCJtZXJtYWlkIjoie1xuICBcInRoZW1lXCI6IFwibmV1dHJhXCJcbn0iLCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9"
  >
    <img
      src="https://mermaid.ink/svg/eyJjb2RlIjoiZ3JhcGggTFJcbiAgICBBW1NvdXJjZSAxXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBCW1NvdXJjZSAyXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBDW1NvdXJjZSAzXSAtLT4gfHF1ZXJ5fCBHYXRzYnlcbiAgICBcbiAgICBHYXRzYnkgLS0-IHxnYXRzYnkgYnVpbGR8IEFsZ29saWEiLCJtZXJtYWlkIjp7InRoZW1lIjoibmV1dHJhbCJ9LCJ1cGRhdGVFZGl0b3IiOmZhbHNlLCJhdXRvU3luYyI6dHJ1ZSwidXBkYXRlRGlhZ3JhbSI6ZmFsc2V9"
      alt="flow diagram"
    />
  </a>
</div>

Here we have an example with some data that might not be very relevant, but will work with the default configuration of `gatsby new`

```shell
yarn add gatsby-plugin-algolia
```

First add credentials to a .env file, which you won't commit. If you track this in your file, and especially if the site is open source, you will leak your admin API key. This would mean anyone is able to change anything on your Algolia index.

```shell
// .env.production
ALGOLIA_APP_ID=XXX
ALGOLIA_API_KEY=XXX
ALGOLIA_INDEX_NAME=XXX
```

```js
require('dotenv').config({
  path: `.env.${process.env.NODE_ENV}`,
});

// gatsby-config.js
const myQuery = `
  query {
    pages: allSitePage {
      nodes {
        # querying id is required
        id
        component
        path
        componentChunkName
        jsonName
        internal {
          # querying internal.contentDigest is required
          contentDigest
          type
          owner
        }
      }
    }
  }
`;

const queries = [
  {
    query: myQuery,
    queryVariables: {}, // optional. Allows you to use graphql query variables in the query
    transformer: ({ data }) => data.pages.nodes, // optional
    indexName: 'index name to target', // overrides main index name, optional
    settings: {
      // optional, any index settings
      // Note: by supplying settings, you will overwrite all existing settings on the index
    },
    mergeSettings: false, // optional, defaults to false. See notes on mergeSettings below
  },
];

module.exports = {
  plugins: [
    {
      // This plugin must be placed last in your list of plugins to ensure that it can query all the GraphQL data
      resolve: `gatsby-plugin-algolia`,
      options: {
        appId: process.env.ALGOLIA_APP_ID,
        // Use Admin API key without GATSBY_ prefix, so that the key isn't exposed in the application
        // Tip: use Search API key with GATSBY_ prefix to access the service from within components
        apiKey: process.env.ALGOLIA_API_KEY,
        indexName: process.env.ALGOLIA_INDEX_NAME, // for all queries
        queries,
        chunkSize: 10000, // default: 1000
        settings: {
          // optional, any index settings
          // Note: by supplying settings, you will overwrite all existing settings on the index
        },
        mergeSettings: false, // optional, defaults to false. See notes on mergeSettings below
        concurrentQueries: false, // default: true
        dryRun: false, // default: false, only calculate which objects would be indexed, but do not push to Algolia
        continueOnFailure: false, // default: false, don't fail the build if Algolia indexing fails
        algoliasearchOptions: undefined, // default: { timeouts: { connect: 1, read: 30, write: 30 } }, pass any different options to the algoliasearch constructor
      },
    },
  ],
};
```

The index will be synchronised with the provided index name on Algolia on the `build` step in Gatsby. This is not done earlier to prevent you going over quota while developing.

## Partial Updates

This plugin will update only the changed or deleted nodes on your Gatsby site.

**We rely on Gatsby's default `contentDigest` field, so make sure it is queried.**

## Settings

You can set settings for each index individually (per query), or otherwise it will keep your existing settings.

### Merge Settings

`mergeSettings` allows you to preserve settings changes made on the Algolia website. The default behavior (`mergeSettings: false`) will wipe out your index settings and replace them with settings from the config on each build.

When set to true, the config index settings will be merged with the existing index settings in Algolia (with the config index settings taking precendence).

NOTE: When using `mergeSettings`, any **deleted** settings from the config settings will continue to be persisted since they will still exist in Algolia. If you want to remove a setting, be sure to remove it from both the config and on Algolia's website.

## Concurrent Queries

Sometimes, on limited platforms like Netlify, concurrent queries to the same index can lead to unexpected results or hanging builds. Setting `concurrentQueries` to `false` makes it such that queries are run sequentially rather than concurrently, which may solve some concurrent access issues. Be aware that this option may make indexing take longer than it would otherwise.

## Transformer

The `transformer` field accepts a function and optionally you may provide an `async` function.

## Feedback

This is the very first version of our plugin and isn't yet officially supported. Please leave all your feedback in GitHub issues 😊
