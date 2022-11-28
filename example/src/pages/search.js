import React from 'react'
import algoliasearch from 'algoliasearch/lite'
import {
  Highlight,
  Hits,
  InstantSearch,

  SearchBox,
} from 'react-instantsearch-hooks-web'
import { Link } from 'gatsby'

const searchClient = algoliasearch(
  process.env.GATSBY_ALGOLIA_APPID,
  process.env.GATSBY_ALGOLIA_APIKEY
)

const SearchPage = () => (
  <>
    <Link to="/">Go back to the homepage</Link>

      <InstantSearch
        searchClient={searchClient}
        indexName={process.env.GATSBY_ALGOLIA_INDEXNAME}
      >
        <SearchBox />
        <Hits hitComponent={DefaultHitComponent} />
      </InstantSearch>

  </>
)

const DefaultHitComponent = ({ hit }) => (
  <pre>
    <div>
      id/objectID: <Highlight attribute="id" hit={hit} />,
    </div>
    <div>
      <Link to={hit.path}>
        path: <Highlight attribute="path" hit={hit} />
      </Link>
      ,
    </div>
    <div>
      internal.contentDigest:{' '}
      <Highlight attribute="internal.contentDigest" hit={hit} />
    </div>
  </pre>
)

export default SearchPage
