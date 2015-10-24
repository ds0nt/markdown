package auth

import (
	"fmt"
	"io/ioutil"
	"net/http"

	"github.com/ant0ine/go-json-rest/rest"
)

type importRequest struct {
	Url string `json:"url"`
}

type importResponse struct {
	Body string `json:"body"`
}

// ImportUrl Route
// @route post /api/importurl
func ImportUrl(w rest.ResponseWriter, r *rest.Request) {
	// email := fmt.Sprintf("%v", r.Env["REMOTE_USER"])

	request := importRequest{}
	if err := r.DecodeJsonPayload(&request); err != nil {
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fmt.Printf("URL: %v", request.Url)

	resp, err := http.Get(request.Url)
	if err != nil {
		rest.Error(w, err.Error(), http.StatusBadGateway)
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)

	response := importResponse{
		Body: string(body),
	}
	w.WriteJson(&response)
}
