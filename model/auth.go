package model

import (
	"encoding/json"
	"fmt"

	"github.com/ds0nt/markdown/config"
	db "github.com/ds0nt/markdown/redis"
	"github.com/fortytw2/abdi"
	"github.com/garyburd/redigo/redis"
	"github.com/grayj/go-json-rest-middleware-tokenauth"
)

var conf = config.Config
var pool = db.Pool

// User as seen in redis
type User struct {
	Email    string
	Password string
}

func init() {
	abdi.Key = []byte(conf.HmacKey)
}

// RegisterAccount takes email/password
// gets redis connection
// returns error if existing user in redis
// hashes password
func Register(email, password string) (*User, error) {
	// Get redis connection
	rd := pool.Get()
	defer rd.Close()

	// Test existing
	exists, err := redis.Bool(rd.Do("EXISTS", conf.UserNamespace+email))
	if err != nil {
		panic(err)
	} else if exists {
		return nil, fmt.Errorf("account conflict")
	}

	// Hash password
	hash, err := abdi.Hash(password)
	if err != nil {
		fmt.Printf("email: %s, password; %s", email, password)
		return nil, err
	}
	user := User{
		Email:    email,
		Password: hash,
	}

	// json marshal user
	data, err := json.Marshal(user)
	if err != nil {
		return nil, err
	}

	// redis set users:email = json user
	_, err = rd.Do("SET", conf.UserNamespace+email, data)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// FindUser gets a user redis
func Find(email string) (*User, error) {
	rd := pool.Get()
	defer rd.Close()
	exists, err := redis.Bool(rd.Do("EXISTS", conf.UserNamespace+email))
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}

	data, err := redis.String(rd.Do("GET", conf.UserNamespace+email))
	if err != nil {
		return nil, err
	}
	user := User{}
	err = json.Unmarshal([]byte(data), &user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func GrantToken(email string) (string, error) {
	token, err := tokenauth.New()
	rd := pool.Get()
	defer rd.Close()
	_, err = rd.Do("SET", conf.TokenNamespace+tokenauth.Hash(token), email, "EX", 604800)
	if err != nil {
		return "", err
	}
	return token, nil
}

func AuthenticateToken(token string) string {
	rd := pool.Get()
	defer rd.Close()
	user, _ := redis.String(rd.Do("GET", conf.TokenNamespace+tokenauth.Hash(token)))
	return user
}

func AuthenticateBasic(email string, password string) bool {
	user, err := Find(email)
	if err != nil {
		fmt.Printf("%s\n", err)
		return false
	}

	if user == nil {
		return false
	}
	if err = abdi.Check(password, user.Password); err == nil {
		fmt.Println("logged in ", user)
		return true
	}

	return false
}
