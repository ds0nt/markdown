#!/bin/bash

can_base() {
  _base=`pwd`/$1
}

can_container() {
  local name="$1"
  local image="$2"
  _name=$name
  _image=$image
  _command=
  _context="$_base/$name"

  mkdir -p "$_context"
  echo -n "" > "$_context/env"
  echo -n "" > "$_context/ports"
  echo -n "" > "$_context/open_ports"
  echo -n "" > "$_context/links"
}

can_volume() {
  local volume="$1"
  mkdir -p "$_context$volume"
}

can_environment() {
  local variable="$1"
  local value="$2"
  echo "$variable=$value" >> "$_context/env"
}
can_i_have_volume() {
  local volume="$1"
  echo "$_context$volume"
}

can_volumes() {
  # recurses directory tree taking only the most distant leafs /db/data will not return /db
  dirmax=`pwd`
  local volumes=$(cd $_context; ls ** -R | grep ":" | sort -r | sed -e "s/://g" | while read x; do
    if ! echo $dirmax | grep $x 1>/dev/null; then
      dirmax=$(echo $x)
      echo $dirmax
    fi
  done; cd - 1>/dev/null)
  for volume in $volumes; do
    echo -v $_context/$volume:/$volume
  done | xargs echo
}

can_envfile() {
  echo --env-file=\"$_context/env\"
}

can_port() {
  local port=$1
  echo "$port" >> "$_context/ports"
}

can_open_port() {
  local port=$1
  echo "$port" >> "$_context/open_ports"
}

can_ports () {
  for port in $(cat "$_context/ports" | xargs); do
    echo "-p $port"
  done | xargs echo
}

can_link () {
  local link=$1
  local target=$2
  echo "$link:$target" >> "$_context/links"
}

can_links () {
  for link in $(cat "$_context/links" | xargs); do
    echo "--link=$link"
  done | xargs echo
}

can_open_ports () {
  for port in $(cat "$_context/open_ports" | xargs); do
    echo "-p $port:$port"
  done | xargs echo
}

can_cp() {
  docker run --name=tmp-$_name $_image sh
  docker cp $1 tmp-$_name:$2
  _image=$(docker commit tmp-$_name)
  docker rm tmp-$_name
}

can_cmd() {
    _command=$1
}

can_dae() {
  docker stop $_name
  docker rm $_name
  docker start $_name 2>/dev/null || docker run -d $(can_volumes) $(can_envfile) $(can_links) $(can_ports) $(can_open_ports) --name=$_name $_image $_command
}

can_i_have_port() {
  port=$1
  docker port $_name | grep $port | cut -d\: -f2
}
