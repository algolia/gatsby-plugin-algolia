import React from 'react'
import { Link } from 'gatsby'

const IndexPage = () => (
  <div>
    <h1>Hi people</h1>
    <p>Welcome to your new Gatsby site.</p>
    <p>Now go build something great.</p>
    <p>
      <Link to="/search/">Go to search</Link>
    </p>
    <p>
      <Link to="/page-2/">Go to page 2</Link>
    </p>
  </div>
)

export default IndexPage
