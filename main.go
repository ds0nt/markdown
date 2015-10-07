package main

import (
	_ "github.com/ds0nt/mdpad/docs"
	_ "github.com/ds0nt/mdpad/routers"

	"github.com/astaxie/beego"
)

func main() {
	if beego.RunMode == "dev" {
		beego.DirectoryIndex = true
		beego.StaticDir["/"] = "app/dist"
		beego.StaticDir["/app"] = "app/dist"
	}
	beego.Run()
}
