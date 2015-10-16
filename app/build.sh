#!/bin/bash

output=$1
if [[ "$output" == "" ]]; then
  output="$(dirname $0)/dist"
else
  output=$(realpath $output)
fi

cd $(dirname $0)

[ -d $output ] || mkdir -p $output
echo "browserify $(pwd)/src/app.js"
browserify -d -e src/app.js -t babelify -o "$output/app.js" -v

echo "myth $(pwd)/src/app.css"
myth src/app.css "$output/app.css"

echo "copy echo $(pwd)/src/public"
cp -urv src/public/* "$output/"
