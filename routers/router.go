package routers

import (
	"github.com/ds0nt/mdpad/controllers"

	"github.com/astaxie/beego"
)

func init() {
	ns := beego.NewNamespace("/v1",
		beego.NSNamespace("/documents",
			beego.NSInclude(
				&controllers.DocumentController{},
			),
		),
		beego.NSNamespace("/user",
			beego.NSInclude(
				&controllers.UserController{},
			),
		),
	)
	beego.AddNamespace(ns)
}
