#!/bin/bash
cd $(dirname $0)
PATH=node_modules/.bin/:$PATH

browserify -d -e src/app.js  -t babelify -o dist/app.js -v
myth src/app.css dist/app.css
cp -urv src/public/* dist/
