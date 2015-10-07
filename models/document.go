package models

import (
	"errors"
	"strconv"
	"time"
)

var (
	Documents map[string]*Document
)

type Document struct {
	Id         string
	Score      int64
	PlayerName string
}

func init() {
	Documents = make(map[string]*Document)
	Documents["hjkhsbnmn123"] = &Document{"hjkhsbnmn123", 100, "astaxie"}
	Documents["mjjkxsxsaa23"] = &Document{"mjjkxsxsaa23", 101, "someone"}
}

func AddOne(document Document) (Id string) {
	document.Id = "astaxie" + strconv.FormatInt(time.Now().UnixNano(), 10)
	Documents[document.Id] = &document
	return document.Id
}

func GetOne(Id string) (document *Document, err error) {
	if v, ok := Documents[Id]; ok {
		return v, nil
	}
	return nil, errors.New("Id Not Exist")
}

func GetAll() map[string]*Document {
	return Documents
}

func Update(Id string, Score int64) (err error) {
	if v, ok := Documents[Id]; ok {
		v.Score = Score
		return nil
	}
	return errors.New("Id Not Exist")
}

func Delete(Id string) {
	delete(Documents, Id)
}
