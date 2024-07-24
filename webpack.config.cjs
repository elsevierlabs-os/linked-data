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
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ],
  },
  optimization: {
    minimize: true
  },
};