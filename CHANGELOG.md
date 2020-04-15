# Change Log

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

<a name="0.7.0"></a>
# [0.7.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.6.0...v0.7.0) (2020-04-10)


### Features

* **replica:** prevent temporary indices to have replicas ([#51](https://github.com/algolia/gatsby-plugin-algolia/issues/51)) ([b3e6fad](https://github.com/algolia/gatsby-plugin-algolia/commit/b3e6fad))



<a name="0.6.0"></a>
# [0.6.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.5.0...v0.6.0) (2020-04-01)


### Features

* **exists:** prevent empty index from being overridden ([e587abe](https://github.com/algolia/gatsby-plugin-algolia/commit/e587abe))



<a name="0.5.0"></a>
# [0.5.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.4.0...v0.5.0) (2019-11-18)


### Bug Fixes

* **settings:** wait for task to finish ([67f4e46](https://github.com/algolia/gatsby-plugin-algolia/commit/67f4e46))


### BREAKING CHANGES

* **settings:** indexing will take a slight bit longer if settings are applied to be more sure we don't set settings on the wrong index.



<a name="0.4.0"></a>
# [0.4.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.3.4...v0.4.0) (2019-11-07)


### Features

* **transformer:** Wait for me! 🙋‍♂️ Ability to await the data transformer ([#40](https://github.com/algolia/gatsby-plugin-algolia/issues/40)) ([d47e35f](https://github.com/algolia/gatsby-plugin-algolia/commit/d47e35f)), closes [#25](https://github.com/algolia/gatsby-plugin-algolia/issues/25)



<a name="0.3.4"></a>
## [0.3.4](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.3.3...v0.3.4) (2019-09-11)

### Bug Fixes

* **settings**: await settings to be sent before moving indices ([231221e](https://github.com/algolia/gatsby-plugin-algolia/commit/231221e)), closes [#37](https://github.com/algolia/gatsby-plugin-algolia/issues/37)

<a name="0.3.3"></a>
## [0.3.3](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.3.2...v0.3.3) (2019-08-12)



<a name="0.3.2"></a>
## [0.3.2](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.3.1...v0.3.2) (2019-07-03)


### Bug Fixes

* **pkg:** add index.js to files ([282b151](https://github.com/algolia/gatsby-plugin-algolia/commit/282b151)), closes [#32](https://github.com/algolia/gatsby-plugin-algolia/issues/32)



<a name="0.3.1"></a>
## [0.3.1](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.3.0...v0.3.1) (2019-07-03)


### Bug Fixes

* Don't publish examples to npm ([#31](https://github.com/algolia/gatsby-plugin-algolia/issues/31)) ([b042481](https://github.com/algolia/gatsby-plugin-algolia/commit/b042481))



<a name="0.3.0"></a>
# [0.3.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.2.0...v0.3.0) (2018-11-13)


### Features

* **settings:** allow user to set settings for each query individually ([#17](https://github.com/algolia/gatsby-plugin-algolia/issues/17)) ([ea6e8b1](https://github.com/algolia/gatsby-plugin-algolia/commit/ea6e8b1))



<a name="0.2.0"></a>
# [0.2.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.1.0...v0.2.0) (2018-10-02)


### Bug Fixes

* don't "atomic" index when there's no info in main index ([#12](https://github.com/algolia/gatsby-plugin-algolia/issues/12)) ([1be256f](https://github.com/algolia/gatsby-plugin-algolia/commit/1be256f))


### Features

* add more detailed logging ([#14](https://github.com/algolia/gatsby-plugin-algolia/issues/14)) ([5e7372a](https://github.com/algolia/gatsby-plugin-algolia/commit/5e7372a))



<a name="0.1.1"></a>
## [0.1.1](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.1.0...v0.1.1) (2018-09-28)


### Features

* Make sure people use the right name for `query` ([2b47488](https://github.com/algolia/gatsby-plugin-algolia/commit/2b47488))

<a name="0.1.0"></a>
## [0.1.0](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.0.4...v0.1.0) (2018-09-05)


### Features

* Atomic indexing ([cc351f0](https://github.com/algolia/gatsby-plugin-algolia/commit/cc351f0))
  * this will add one more index while you're indexing to always have live data on your index


<a name="0.0.4"></a>
## [0.0.4](https://github.com/algolia/gatsby-plugin-algolia/compare/v0.0.3...v0.0.4) (2018-05-30)


### Features

* Allow multiple indices ([fd6d9e5](https://github.com/algolia/gatsby-plugin-algolia/commit/fd6d9e5))
* make indexName in query and transformer optional ([337fdc8](https://github.com/algolia/gatsby-plugin-algolia/commit/337fdc8))



# Change Log

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.
