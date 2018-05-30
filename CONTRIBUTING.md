# Gatsby Plugin for Algolia

Hey there! Thanks for looking into how to contribute to our Algolia plugin 💌. This plugin works by hooking into the `onPostBuild` hook in Gatsby, so it will only run on production builds, not on development builds. 

The goals of this project are to create a nice plugin which will do _as little as operations as possible_ and be _as fast as possible_ to generate any Algolia index from arbitrary Gatsby graphQL queries.

Any contribution is of course welcome!

## Releasing

```sh
yarn release
npm publish
```

## Commits

Make sure you follow ["conventional commits"](https://github.com/conventional-changelog/standard-version#commit-message-convention-at-a-glance), so that it shows up nicely in the changelog.
