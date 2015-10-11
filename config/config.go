package config

import (
	"io/ioutil"
	"os"

	"github.com/pcx/example-docker-agent/log"

	"gopkg.in/yaml.v2"
)

// Config for klouds master
type ConfigScheme struct {
	Port                  string `yaml:"port"`
	AuthRealm             string `yaml:"auth_realm"`
	UserNamespace         string `yaml:"user_namespace"`
	TokenNamespace        string `yaml:"token_namespace"`
	RedisServer           string `yaml:"redis_server"`
	RedisPassword         string `yaml:"redis_password"`
	MysqlConnectionString string `yaml:"mysql_connection_string"`
	HmacKey               string `yaml:"hmac_key"`
}

var (
	Config     = ConfigScheme{}
	configFile = "config.yml"
)

func init() {
	// verify files exist
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		log.Fatalf("klouds config file: %s\n", err)
	}
	err := ParseConfig(configFile)
	if err != nil {
		log.Fatal(err)
	}
}

// Init unmarshalls Config from YAML configuration in filename
func ParseConfig(filename string) error {
	data, err := ioutil.ReadFile(filename)
	if err != nil {
		return err
	}
	err = yaml.Unmarshal(data, &Config)
	if err != nil {
		return err
	}
	log.Infof("read config %v\n", Config)
	return nil
}
