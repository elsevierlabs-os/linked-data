const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/inspector.js',
  watch: false,
  output: {
    filename: 'inspector.js',
    path: path.resolve(__dirname, 'media'),
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(?:js|mjs|cjs)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: "defaults", modules: "commonjs"}]
            ]
          }
        }
      }
    ],
  },
  optimization: {
    minimize: false
  },
};