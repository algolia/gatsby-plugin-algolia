require('dotenv').config({
  path: `.env.${process.env.NODE_ENV}`,
})

const query = `
  {
    allSitePage {
      nodes {
        id
        internal {
          contentDigest
        }
        path
      }
    }
  }
`

const queries = [
  {
    query,
    transformer: ({ data }) => data.allSitePage.nodes,
    // optional
    // indexName: 'pages',
    // optional
    settings: {
      attributesToSnippet: ['path:5'],
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
      },
    },
  ],
}
