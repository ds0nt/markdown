#!/bin/bash

output=$1
if [[ "$output" == "" ]]; then
  output="$(dirname $0)/dist"
else
  output=$(realpath $output)
fi

scanActions() {
  echo 'window.ACTIONS = {}'
  grep -rEo 'ACTIONS\.[A-Z_]+' ./* | cut -d: -f2 | cut -d. -f2 | sort | uniq | while read x; do
    echo "window.ACTIONS.$x = '$x'"
  done
}

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

scanActions > "$output/actions.js"

build $output
