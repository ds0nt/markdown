import Backbone from 'backbone';
import Router from './router';

export default class Application {
  constructor() {
    this.router = new Router();
  }

  start() {
    Backbone.history.start({ pushState: true });
  }
}
