# Gatsby plugin Algolia

> This plugin is in _beta_ and not officially supported yet
>
> Feel free to open issues for any questions or ideas

You can specify a list of queries to run and how to transform them into an array of objects to index. When you run `gatsby build`, it will publish those to Algolia.

Here we have an example with some data that might not be very relevant, but will work with the default configuration of `gatsby new`

```sh
$ yarn add gatsby-plugin-algolia
```

```js
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
  },
];

module.exports = {
  plugins: [
    {
      resolve: `gatsby-plugin-algolia`,
      options: {
        appId: 'your appId',
        apiKey: 'your admin api key',
        indexName: "index name to target", // for all queries
        queries,
        chunkSize: 10000, // default: 1000
      },
    },
  ],
};
```

# Feedback

This is the very first version of our plugin and isn't yet officially supported. Please leave all your feedback in GitHub issues 😊
