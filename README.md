# Gatsby plugin Algolia

> This plugin is in _beta_ and not officially supported yet
>
> Feel free to open issues for any questions or ideas

You can specify a list of queries to run and how to transform them into an array of objects to index. When you run `gatsby build`, it will publish those to Algolia.

Here we have an example with some data that might not be very relevant, but will work with the default configuration of `gatsby new`

```sh
$ yarn add gatsby-plugin-algolia
```

First add credentials to a .env file, which you won't commit. If you track this in your file, and especially if the site is open source, you will leak your admin API key. This would mean anyone is able to change anything on your Algolia index.

```env
// .env.production
ALGOLIA_APP_ID=XXX
ALGOLIA_API_KEY=XXX
ALGOLIA_INDEX_NAME=XXX
```

```js
require('dotenv').config({
  path: `.env.${process.env.NODE_ENV}`,
})

// gatsby-config.js
const myQuery = `{
  allSitePage {
    edges {
      node {
        # try to find a unique id for each node
        # if this field is absent, it's going to
        # be inserted by Algolia automatically
        # and will be less simple to update etc.
        objectID: id
        component
        path
        componentChunkName
        jsonName
        internal {
          type
          contentDigest
          owner
        }
      }
    }
  }
}`;

const queries = [
  {
    query: myQuery,
    transformer: ({ data }) => data.allSitePage.edges.map(({ node }) => node), // optional
    indexName: 'index name to target', // overrides main index name, optional
    settings: {
      // optional, any index settings
    },
    matchFields: ['slug', 'modified'], // Array<String> overrides main match fields, optional
  },
];

module.exports = {
  plugins: [
    {
      resolve: `gatsby-plugin-algolia`,
      options: {
        appId: process.env.ALGOLIA_APP_ID,
        apiKey: process.env.ALGOLIA_API_KEY,
        indexName: "index name to target", // for all queries
        queries,
        chunkSize: 10000, // default: 1000
        enablePartialUpdates: true, // default: false
        matchFields: ['slug', 'modified'], // Array<String> default: ['modified']
      },
    },
  ],
};
```

# Partial Updates `v0.4.0`

By default all records will be reindexed on every build. To enable only indexing the new, changed and deleted records include the following in the options of the plugin:

```js
  resolve: `gatsby-plugin-algolia`,
  options: {
    /* ... */
    enablePartialUpdates: true,
    /* (optional) Fields to use for comparing if the index object is different from the new one */
    /* By default it uses a field called modified which could be a boolean | datatime string */
    matchFields: ['slug', 'modified'] // Array<String> default: ['modified']
  }
```

This saves a lot of Algolia operations since you don't reindex everything on everybuild.

### Advanced

You can also specify `matchFields` per query to check for different fields based on the type of objects you are indexing.


# Feedback

This is the very first version of our plugin and isn't yet officially supported. Please leave all your feedback in GitHub issues 😊
