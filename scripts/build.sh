#!/bin/bash

cd $(dirname $0)/..

routes() {
  echo
  find -path './rest*' -name '**.go' | while read file; do
    import=$(cat $file | grep -Eo "package.*" | sed -e 's/package\s//g')
    cat "$file" | grep -A1 -E '@route.*' | while read route_line; read func_line; do
      route_pair="$(echo "$route_line" | grep -Eo '[^ ]+\s[^ ]+$')"
      http_method=$(echo $route_pair | cut -d\  -f1)
      http_url=$(echo $route_pair | cut -d\  -f2)

      func_name="$(echo "$func_line" | grep -Eo '\s[a-zA-Z0-9]*\(' | sed -e 's/[\ (]//g')"
      echo ""
      echo "func_name: $import.$func_name"
      echo "http_method: $http_method"
      echo "http_url: $http_url"
    done
  done
}

routes
