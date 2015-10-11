#!/bin/bash

[ "$API" ] || API="http://127.0.0.1:5000"

email="`date -Is`@email.sh"

# Authentication

# /auth/login
echo -e "send register with malformed json:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/register" \
  -d 't!@#$!@#password" }%%%' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send register with short password:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/register" \
  -d '{"email":"'$email'","password":"test" }' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send register OK:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/register" \
  -d '{"email":"'$email'","password":"testpassword" }' | head -1
echo -e "Expected 200 OK\n"

echo -e "send register again:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/register" \
  -d '{"email":"'$email'","password":"testpassword" }' | head -1
echo -e "Expected 409 Conflict\n"

# /auth/register
echo -e "send login with malformed json:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/login" \
  -d 't!@#$!@#password" }%%%' | head -1
echo -e "Expected 400 Bad Request\n"

echo -e "send login with unregistered email / password:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/login" \
  -d '{"email":"this-email-doesnt-exist@forky.io","password":"testpassword" }' | head -1
echo -e "Expected 401 Unauthorized\n"

echo -e "send login with incorrect password:"
curl -i -s -H 'Content-Type: application/json' "$API/auth/login" \
  -d '{"email":"'$email'","password":"failpassword" }' | head -1
echo -e "Expected 401 Unauthorized\n"

echo -e "send login OK:"
login=$(curl -i -s -H 'Content-Type: application/json' "$API/auth/login" \
  -d '{"email":"'$email'","password":"testpassword" }')
echo "$login" | head -1
echo -e "Expected 200 OK\n"


# grab token (grep to line in json, field delimiter \", field 3)
access_token=$(echo $login | grep -Eo 'access_token.*' | cut -d'"' -f3)
echo -e "Access Token: $access_token\n"



echo -e "\n\nget documents without authorization"
curl -i -s "$API/api/documents" | head -1
echo -e "Expected 401 Unauthorized\n"


# Documents Resource
echo -e "\ncreate document"
document=$(curl -s -H "Authorization: Token $access_token" -H 'Content-Type: application/json' -d '{"name":"api-test document","body":"revision alpha"}' "$API/api/documents")
echo $document

# grab id (grep to line in json, field delimiter \", field 3)
document_id=$(echo $document | grep -Eo 'id.*' | cut -d' ' -f2 | cut -d',' -f1)
echo -e "Document Id: $document_id\n"

echo -e "\n\nget document"
curl -s -H "Authorization: Token $access_token" "$API/api/documents/$document_id"

echo -e "\n\nlist documents"
curl -s -H "Authorization: Token $access_token" "$API/api/documents"

echo -e "\n\nupdate document"
curl -s -H "Authorization: Token $access_token" -X PUT -H 'Content-Type: application/json' -d '{"name":"api-test", "body":"revision beta"}' "$API/api/documents/$document_id"

echo -e "\n\ndelete document"
curl -i -s -H "Authorization: Token $access_token" -X DELETE "$API/api/documents/$document_id"
