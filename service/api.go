package main

import (
	"log"

	"net/http"

	"github.com/ant0ine/go-json-rest/rest"
	"github.com/ds0nt/markdown/config"
	"github.com/ds0nt/markdown/model/auth"
	restapi "github.com/ds0nt/markdown/rest"
	"github.com/grayj/go-json-rest-middleware-tokenauth"
)

var (
	conf = config.Config
)

func main() {

	api := rest.NewApi()
	api.Use(rest.DefaultDevStack...)

	api.Use(&rest.CorsMiddleware{
		RejectNonCorsRequests: false,
		OriginValidator: func(origin string, request *rest.Request) bool {
			return true // origin == "http://127.0.0.1"
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "OPTIONS", "DELETE"},
		AllowedHeaders: []string{
			"Accept", "Content-Type", "Authorization", "Origin"},
		AccessControlAllowCredentials: true,
		AccessControlMaxAge:           3600,
	})
	api.Use(AuthMiddleware())

	router, err := rest.MakeRouter(
		rest.Post("/auth/login", restapi.Login),
		rest.Post("/auth/register", restapi.Register),
		rest.Get("/api/documents", restapi.GetAllDocuments),
		rest.Post("/api/documents", restapi.PostDocument),
		rest.Get("/api/documents/:id", restapi.GetDocument),
		rest.Put("/api/documents/:id", restapi.PutDocument),
		rest.Delete("/api/documents/:id", restapi.DeleteDocument),
	)

	if err != nil {
		log.Fatal(err)
	}
	api.SetApp(router)

	log.Printf("Port %s\n", conf.Port)
	log.Fatal(http.ListenAndServe(":"+conf.Port, api.MakeHandler()))
}

//AuthMiddleware is the authorization middleware
func AuthMiddleware() rest.Middleware {
	return &rest.IfMiddleware{
		Condition: func(request *rest.Request) bool {
			return request.URL.Path[:4] == "/api"
		},
		IfTrue: &tokenauth.AuthTokenMiddleware{
			Realm:         "token-auth",
			Authenticator: model.AuthenticateToken,
		},
	}
}

//https://github.com/stripe/stripe-go/blob/a6e40c8d67e2563657721d2ab50ef57888b4af7b/example_test.go
// "github.com/stripe/stripe-go/client"
// "github.com/stripe/stripe-go"
// func newCustomer()  {
// 	params := &stripe.CustomerParams{
//     Balance: -123,
//     Desc:  "Stripe Developer",
//     Email: "gostripe@stripe.com",
// 		Token: token
// 	}
//
// 	customer, err := customer.New(params)
// }
