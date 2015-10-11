package redis

import (
	"time"

	"github.com/ds0nt/markdown/config"
	"github.com/garyburd/redigo/redis"
)

var (
	Pool *redis.Pool
	conf = config.Config
)

func init() {
	Pool = &redis.Pool{
		MaxIdle:     3,
		IdleTimeout: 240 * time.Second,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial("tcp", conf.RedisServer)
			if err != nil {
				return nil, err
			}
			if conf.RedisPassword != "" {
				_, err := c.Do("AUTH", conf.RedisPassword)
				if err != nil {
					c.Close()
					return nil, err
				}
			}
			return c, err
		},
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	}
}
