require('dotenv').config({
  path: `.env.${process.env.NODE_ENV}`,
})

const query = `{
  allSitePage {
    edges {
      node {
        # try to find a unique id for each node
        # if this field is absent, it's going to
        # be inserted by Algolia automatically
        # and will be less simple to update etc.
        objectID: id
        path
        internal {
          contentDigest
        }
      }
    }
  }
}`

const queries = [
  {
    query,
    transformer: ({ data }) =>
      data.allSitePage.edges.map(({ node: { internal, ...node } }) => ({
        ...node,
        contentDigest: internal.contentDigest,
      })),
    // optional
    // indexName: 'pages',
    // optional
    settings: {
      attributesToSnippet: ['path:5', 'internal'],
    },
  },
]

module.exports = {
  siteMetadata: {
    title: 'Gatsby Algolia Example',
  },
  plugins: [
    {
      // in real life this would be:
      // resolve: 'gatsby-plugin-algolia',
      resolve: require.resolve('../'),
      options: {
        appId: process.env.ALGOLIA_APPID,
        apiKey: process.env.ALGOLIA_APIKEY,
        indexName: process.env.ALGOLIA_INDEXNAME, // for all queries
        queries,
        chunkSize: 10000, // default: 1000
        enablePartialUpdates: true, // default: false
        matchFields: ['contentDigest'],
      },
    },
  ],
}
