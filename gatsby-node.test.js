const { onPostBuild } = require('./gatsby-node');
const { test, beforeEach, describe } = require('@jest/globals');
const { default: algoliasearch } = require('algoliasearch');

jest.mock('algoliasearch');

const GatsbyGlobals = {
  graphql: jest.fn(),
  reporter: {
    activityTimer: jest.fn(() => ({
      setStatus: jest.fn(),
      start: jest.fn(),
      end: jest.fn(),
    })),
  },
  cache: jest.fn(),
};

beforeEach(() => {
  GatsbyGlobals.graphql.mockClear();
  GatsbyGlobals.reporter.activityTimer.mockClear();
  GatsbyGlobals.cache.mockClear();
});

describe('algoliasearch', () => {
  test('instantiates algoliasearch client', async () => {
    const config = {
      queries: [],
      appId: 'appId',
      apiKey: 'apiKey',
    };
    await onPostBuild(GatsbyGlobals, config);

    expect(algoliasearch).toHaveBeenCalledWith(config.appId, config.apiKey, {
      timeouts: { connect: 1, read: 30, write: 30 },
    });
  });

  test('instantiates algoliasearch client with custom config', async () => {
    const config = {
      queries: [],
      appId: 'appId',
      apiKey: 'apiKey',
      algoliasearchOptions: {
        swag: true,
      },
    };
    await onPostBuild(GatsbyGlobals, config);

    expect(algoliasearch).toHaveBeenCalledWith(config.appId, config.apiKey, {
      swag: true,
    });
  });
});
