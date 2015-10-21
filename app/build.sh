#!/bin/bash

output=$1
if [[ "$output" == "" ]]; then
  output="$(dirname $0)/dist"
else
  output=$(realpath $output)
fi

build() {
  local dist="$1"
  [ -d $dist ] || mkdir -p $dist
  echo "browserify $(pwd)/src/app.js"
  browserify -d -e src/app.js -t babelify -o "$dist/app.js" -v

  echo "myth $(pwd)/src/app.css"
  myth src/app.css "$dist/app.css"

  echo "copy echo $(pwd)/src/public"
  cp -urv src/public/* "$dist/"
}

build $output
