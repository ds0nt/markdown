#!/bin/bash
PATH=node_modules/.bin/:$PATH

livereload ./dist &

watchman src \
  "browserify -d src/app.js -t babelify -o dist/app.js -v &&\
  myth src/app.css dist/app.css &&\
  cp -urv src/public/* dist/"