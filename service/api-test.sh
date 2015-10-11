#!/bin/bash

[ "$API" ] || API="http://127.0.0.1:5000"

email="`date -Is`@email.sh"

echo -e "send register with malformed json:"
curl -i -s "$API/auth/login"              \
  -H "Content-Type: application/json"  \
  -d 't!@#$!@#password" }%%%' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send register with short password:"
curl -i -s "$API/auth/register"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"'$email'","password":"test" }' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send register OK:"
curl -i -s "$API/auth/register"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"'$email'","password":"testpassword" }' | head -1
echo -e "Expected 200 OK\n"

echo -e "send register again:"
curl -i -s "$API/auth/register"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"'$email'","password":"testpassword" }' | head -1
echo -e "Expected 409 Conflict\n"

echo -e "send login with malformed json:"
curl -i -s "$API/auth/login"              \
  -H "Content-Type: application/json"  \
  -d 't!@#$!@#password" }%%%' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send login with unregistered email / password:"
curl -i -s "$API/auth/login"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"this-email-doesnt-exist@forky.io","password":"testpassword" }' | head -1
echo -e "Expected 401 Unauthorized\n"

echo -e "send login with incorrect password:"
curl -i -s "$API/auth/login"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"'$email'","password":"failpassword" }' | head -1
echo -e "Expected 401 Unauthorized\n"

echo -e "send login OK:"
curl -i -s "$API/auth/login"              \
  -H "Content-Type: application/json"  \
  -d '{"email":"'$email'","password":"testpassword" }' | grep -E "HTTP|\{|access|\}"
echo -e "Expected 200 OK\n"
echo '{ "access_token": "..." }'
