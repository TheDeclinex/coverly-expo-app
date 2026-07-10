module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    sourceCommit: process.env.EAS_BUILD_GIT_COMMIT_HASH
      ?? process.env.EXPO_PUBLIC_SOURCE_COMMIT
      ?? null,
  },
});
