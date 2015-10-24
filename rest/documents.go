package auth

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/ant0ine/go-json-rest/rest"
	conf "github.com/ds0nt/markdown/config"
	_ "github.com/go-sql-driver/mysql"
	"github.com/jinzhu/gorm"
)

type Document struct {
	Id          int64     `json:"id"`
	Email       string    `sql:"type:varchar(100);" json:"email"`
	Name        string    `sql:"size:1024" json:"name"`
	Description string    `sql:"size:1024" json:"name"`
	Body        string    `sql:"size:65536" json:"body"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	DeletedAt   time.Time `json:"-"`
}

var config = conf.Config
var DB gorm.DB

func init() {
	var err error

	DB, err = gorm.Open("mysql", config.MysqlConnectionString)
	if err != nil {
		log.Fatalf("Got error when connect database, the error is '%v'", err)
	}

	DB.LogMode(true)
	DB.AutoMigrate(&Document{})
}

// GetAllDocuments Route
// @route Get /api/documents
func GetAllDocuments(w rest.ResponseWriter, r *rest.Request) {
	email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])
	documents := []Document{}
	DB.Where("email = ?", email).Find(&documents)
	w.WriteJson(&documents)
}

// GetDocument Route
// @route Get /api/documents/:id
func GetDocument(w rest.ResponseWriter, r *rest.Request) {
	email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])
	id := r.PathParam("id")

	document := Document{}
	if DB.Where("email = ?", email).First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}
	w.WriteJson(&document)
}

func splitBody(body string) (string, string) {
	var name, description, remainder string
	if i := strings.Index(body, "\n"); i > 0 {
		name = body[0:i]
		remainder = body[i:]
		if len(remainder) < 255 {
			description = remainder
		} else {
			description = remainder[:255]
		}
	} else {
		name = body
	}
	name = regexp.MustCompile("^[^A-Za-z0-9]*").ReplaceAllString(name, "")
	description = regexp.MustCompile("^[^A-Za-z0-9]*").ReplaceAllString(description, "")
	return name, description
}

// PostDocument RoutePut
// @route Post /api/documents
func PostDocument(w rest.ResponseWriter, r *rest.Request) {
	email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])
	document := Document{}
	if err := r.DecodeJsonPayload(&document); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	document.Email = email
	document.Name, document.Description = splitBody(document.Body)

	if err := DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

// PutDocument Route
// @route Put /api/documents/:id
func PutDocument(w rest.ResponseWriter, r *rest.Request) {
	email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])

	id := r.PathParam("id")
	document := Document{}
	if DB.Where("email = ?", email).First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}

	updated := Document{}
	if err := r.DecodeJsonPayload(&updated); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	document.Body = updated.Body
	document.Name, document.Description = splitBody(document.Body)

	if err := DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

// DeleteDocument Route
// @route Delete /api/documents/:id
func DeleteDocument(w rest.ResponseWriter, r *rest.Request) {
	email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])
	id := r.PathParam("id")
	document := Document{}
	if DB.Where("email = ?", email).First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}
	if err := DB.Delete(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
