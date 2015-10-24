package auth

import (
	"log"
	"net/http"

	"github.com/ant0ine/go-json-rest/rest"
	"github.com/ds0nt/markdown/model/auth"
)

type loginPayload struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	Email string `json:"email"`
	Token string `json:"access_token"`
}

type registerPayload struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registerResponse struct {
	Email string `json:"email"`
	Token string `json:"access_token"`
}

// Login Route
// @route Post /login
func Login(w rest.ResponseWriter, r *rest.Request) {
	account := loginPayload{}

	if err := r.DecodeJsonPayload(&account); err != nil {
		rest.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	log.Printf("login: %v", account.Email)
	if !model.AuthenticateBasic(account.Email, account.Password) {
		rest.Error(w, "Invalid email or password", http.StatusUnauthorized)
		return
	}
	token, err := model.GrantToken(account.Email)
	if err != nil {
		rest.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	// Give token.
	w.WriteJson(loginResponse{
		Token: token,
	})
}

// Register Route
// @route Post /register
func Register(w rest.ResponseWriter, r *rest.Request) {
	account := registerPayload{}

	if err := r.DecodeJsonPayload(&account); err != nil {
		rest.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	log.Printf("register: %v", account.Email)
	user, err := model.Register(account.Email, account.Password)
	if err != nil {
		if err.Error() == "account conflict" {
			rest.Error(w, "Account is already registered", http.StatusConflict)
			return
		}
		if err.Error() == "passwords must be 8 characters or greater" {
			rest.Error(w, "Passwords must be 8 characters or greater", http.StatusBadRequest)
			return
		}
		rest.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	token, err := model.GrantToken(account.Email)
	if err != nil {
		rest.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.WriteJson(registerResponse{
		Email: user.Email,
		Token: token,
	})
}
