package controllers

import (
	"encoding/json"

	"github.com/ds0nt/mdpad/models"

	"github.com/astaxie/beego"
)

// Operations about documents
type DocumentController struct {
	beego.Controller
}

// @Title createdocument
// @Description create documents
// @Param	body		body 	models.Document	true		"The object content"
// @Success 200 {string} models.Document.Id
// @Failure 403 body is empty
// @router / [post]
func (o *DocumentController) Post() {
	var ob models.Document
	json.Unmarshal(o.Ctx.Input.RequestBody, &ob)
	objectid := models.AddOne(ob)
	o.Data["json"] = map[string]string{"id": objectid}
	o.ServeJson()
}

// @Title Get
// @Description get all documents
// @Param	id		path 	string	true		"the objectid you want to get"
// @Success 200 {object} models.Document
// @Failure 403 :id is empty
// @router /:id [get]
func (o *DocumentController) Get() {
	id := o.Ctx.Input.Params[":id"]
	if id != "" {
		ob, err := models.GetOne(id)
		if err != nil {
			o.Data["json"] = err
		} else {
			o.Data["json"] = ob
		}
	}
	o.ServeJson()
}

// @Title Get
// @Description get document by uid
// @Success 200 {object} models.Document
// @Failure 403 :id is empty
// @router / [get]
func (o *DocumentController) GetAll() {
	obs := models.GetAll()
	o.Data["json"] = obs
	o.ServeJson()
}

// @Title update
// @Description update the document
// @Param	id		path 	string	true		"The objectid you want to update"
// @Param	body		body 	models.Document	true		"The body"
// @Success 200 {object} models.Document
// @Failure 403 :id is empty
// @router /:id [put]
func (o *DocumentController) Put() {
	id := o.Ctx.Input.Params[":id"]
	var ob models.Document
	json.Unmarshal(o.Ctx.Input.RequestBody, &ob)

	err := models.Update(id, ob.Score)
	if err != nil {
		o.Data["json"] = err
	} else {
		o.Data["json"] = "update success!"
	}
	o.ServeJson()
}

// @Title delete
// @Description delete the document
// @Param	id		path 	string	true		"The id you want to delete"
// @Success 200 {string} delete success!
// @Failure 403 id is empty
// @router /:id [delete]
func (o *DocumentController) Delete() {
	id := o.Ctx.Input.Params[":id"]
	models.Delete(id)
	o.Data["json"] = "delete success!"
	o.ServeJson()
}
