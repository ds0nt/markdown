package auth

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/ant0ine/go-json-rest/rest"
	model "github.com/ds0nt/markdown/model/documents"
)

func GetAllDocuments(w rest.ResponseWriter, r *rest.Request) {
	documents := []model.Document{}
	model.DB.Find(&documents)
	w.WriteJson(&documents)
}

func GetDocument(w rest.ResponseWriter, r *rest.Request) {
	id := r.PathParam("id")
	document := model.Document{}
	if model.DB.First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}
	w.WriteJson(&document)
}

func PostDocument(w rest.ResponseWriter, r *rest.Request) {
	document := model.Document{}
	if err := r.DecodeJsonPayload(&document); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if i := strings.Index(document.Body, "\n"); i > 0 {
		document.Name = document.Body[0:i]
	} else {
		document.Name = document.Body
	}
	document.Name = regexp.MustCompile("^[^A-Za-z0-9]*").ReplaceAllString(document.Name, "")
	if err := model.DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

func PutDocument(w rest.ResponseWriter, r *rest.Request) {

	id := r.PathParam("id")
	document := model.Document{}
	if model.DB.First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}

	updated := model.Document{}
	if err := r.DecodeJsonPayload(&updated); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if i := strings.Index(document.Body, "\n"); i > 0 {
		document.Name = document.Body[0:i]
	} else {
		document.Name = document.Body
	}
	document.Name = regexp.MustCompile("^[^A-Za-z0-9]*").ReplaceAllString(document.Name, "")
	document.Body = updated.Body

	if err := model.DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

func DeleteDocument(w rest.ResponseWriter, r *rest.Request) {
	id := r.PathParam("id")
	document := model.Document{}
	if model.DB.First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}
	if err := model.DB.Delete(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
