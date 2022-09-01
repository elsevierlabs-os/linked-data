const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/inspector.js',
  watch: true,
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
    ],
  }
};