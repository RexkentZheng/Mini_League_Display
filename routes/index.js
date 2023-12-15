import express from 'express';
var router = express.Router();
import League from './main.js'

/* GET home page. */
router.get('/', function(req, res, next) {
  const league = new League()
  league.getChampions()
  console.log('------league------', league)
  res.render('index', { title: 'Express' });
  
});

export default router