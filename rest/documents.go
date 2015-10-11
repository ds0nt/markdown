package auth

import (
	"net/http"

	"github.com/ant0ine/go-json-rest/rest"
	model "github.com/ds0nt/markdown/model/documents"
)

// GetAllDocuments
func GetAllDocuments(w rest.ResponseWriter, r *rest.Request) {
	documents := []model.Document{}
	model.DB.Find(&documents)
	w.WriteJson(&documents)
}

// GetDocument
func GetDocument(w rest.ResponseWriter, r *rest.Request) {
	id := r.PathParam("id")
	document := model.Document{}
	if model.DB.First(&document, id).Error != nil {
		rest.NotFound(w, r)
		return
	}
	w.WriteJson(&document)
}

// PostDocument
func PostDocument(w rest.ResponseWriter, r *rest.Request) {
	document := model.Document{}
	if err := r.DecodeJsonPayload(&document); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := model.DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

// PutDocument
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

	document.Name = updated.Name
	document.Body = updated.Body

	if err := model.DB.Save(&document).Error; err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteJson(&document)
}

// DeleteDocument
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
