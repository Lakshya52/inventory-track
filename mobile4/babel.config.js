// NativeWind v5 does not use a Babel preset. Keep only the standard Expo preset.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
