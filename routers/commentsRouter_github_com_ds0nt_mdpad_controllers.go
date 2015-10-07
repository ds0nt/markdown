package routers

import (
	"github.com/astaxie/beego"
)

func init() {

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"],
		beego.ControllerComments{
			"Post",
			`/`,
			[]string{"post"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"],
		beego.ControllerComments{
			"Get",
			`/:id`,
			[]string{"get"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"],
		beego.ControllerComments{
			"GetAll",
			`/`,
			[]string{"get"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"],
		beego.ControllerComments{
			"Put",
			`/:id`,
			[]string{"put"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:DocumentController"],
		beego.ControllerComments{
			"Delete",
			`/:id`,
			[]string{"delete"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Post",
			`/`,
			[]string{"post"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"GetAll",
			`/`,
			[]string{"get"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Get",
			`/:uid`,
			[]string{"get"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Put",
			`/:uid`,
			[]string{"put"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Delete",
			`/:uid`,
			[]string{"delete"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Login",
			`/login`,
			[]string{"get"},
			nil})

	beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"] = append(beego.GlobalControllerRouter["github.com/ds0nt/mdpad/controllers:UserController"],
		beego.ControllerComments{
			"Logout",
			`/logout`,
			[]string{"get"},
			nil})

}
