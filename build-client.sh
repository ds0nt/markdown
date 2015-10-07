#!/bin/bash

build() {
bash <<\
______________________
  cd `dirname $0`/app

  PATH=node_modules/.bin:$PATH
  export NODE_ENV=development
  export API="http://localhost:8080"

  cp -urv src/index.html dist/index.html
  browserify -d src/app.js -t babelify -o dist/app.js -v 2> >(cat - | sed -e "s/^.*\sat\s.*$//g")
  myth src/app.css dist/app.css
______________________
}

build
