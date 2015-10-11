package documents

import (
	"log"
	"time"

	conf "github.com/ds0nt/markdown/config"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jinzhu/gorm"
)

type Document struct {
	Id        int64     `json:"id"`
	Name      string    `sql:"size:1024" json:"name"`
	Body      string    `sql:"size:65536" json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt time.Time `json:"-"`
}

var DB gorm.DB
var config = conf.Config

func init() {
	var err error
	DB, err = gorm.Open("mysql", config.MysqlConnectionString)
	if err != nil {
		log.Fatalf("Got error when connect database, the error is '%v'", err)
	}

	DB.LogMode(true)

	DB.AutoMigrate(&Document{})
}
