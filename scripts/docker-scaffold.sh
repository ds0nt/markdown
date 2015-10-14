#!/bin/bash
source $(dirname $0)/docker-alpha.sh


can_base .docker

can_container markdown-mysql orchardup/mysql
can_environment MYSQL_DATABASE markdown-mysql
can_volume "/data"
can_dae
mysql_port=$(can_i_have_port 3306)


can_container markdown-redis redis
can_volume "/data"
can_dae
redis_port=$(can_i_have_port 6379)

can_container markdown-app markdown-app
can_base .docker
can_port 8080
can_port 5000
can_volume "/app"
can_link markdown-redis markdown-redis
can_link markdown-mysql markdown-mysql
can_dae
http_port=$(can_i_have_port 8080)
api_port=$(can_i_have_port 5000)

can_container markdown-proxy haproxy
can_volume "/usr/local/etc/haproxy"
can_open_port 80
can_open_port 5000
can_link markdown-app markdown-app

tee > $(can_i_have_volume /usr/local/etc/haproxy)/haproxy.cfg <<EOF
global
    maxconn 4096

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

frontend http-in *:80
    default_backend http
  	reqidel				^X-Real-IP:.*
  	reqidel 			^X-Forwarded-For:.*
  	reqidel 			^Forwarded:.*

frontend api-in *:5000
    default_backend api
  	reqidel				^X-Real-IP:.*
  	reqidel 			^X-Forwarded-For:.*
  	reqidel 			^Forwarded:.*

backend http
    server web-server markdown-app:8080

backend api
    server api-server markdown-app:5000

EOF
can_dae
