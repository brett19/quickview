/**
 * Module dependencies.
 */

var express = require('express');
var fs = require('fs');
var chokidar = require('chokidar');
var path = require('path');
var spawn = require('child_process').spawn;
var app = express();

var state = {
  READY: 0,
  UNBUILT: 1,
  BUILDING: 2,
  ERROR: 3
};

var fileRevId = 0;
var buildRevId = 0;
var log = '';
var firstBuildDone = false;
var status = state.UNBUILT;
var exitcode = null;
var startTime = null;
var lastTimeTaken = 8000;
var autoRebuild = true;
var autoRefresh = false;

var ditamapPath = process.argv[2];

function updateDocs(callback) {
  if (status === state.BUILDING) {
    // Don't allow multiple concurrent rebuilds
    return;
  }

  log = '';
  exitcode = null;

  startTime = new Date();
  status = state.BUILDING;

  var thisBuildRevId = fileRevId;

  var ls    = spawn('ant', [
      '-Dargs.input=' + ditamapPath,
      '-Doutput.dir=' + __dirname + '/temp',
      '-Dtranstype=com.couchbase.docs.html'
  ]);

  ls.stdout.on('data', function (data) {
    log += '<span>' + data + '</span>';
  });

  ls.stderr.on('data', function (data) {
    log += '<span style="color:#C30;">' + data + '</span>';
  });

  ls.on('close', function (code) {
    exitcode = code;

    if (code) {
      status = state.ERROR;
    } else {
      status = state.READY;
      buildRevId = thisBuildRevId;
      firstBuildDone = true;
    }

    lastTimeTaken = (new Date()).getTime() - startTime.getTime();
    startTime = null;

    if (callback) {
      callback();
    }
  });
}
updateDocs();

chokidar.watch(path.dirname(ditamapPath), {ignoreInitial:true}).on('all', function(e, p) {
  console.log('Detected file change.');
  fileRevId++;
  if (autoRebuild) {
    updateDocs();
  }
});

function currentStatus() {
  var curRunTime = 0;
  if (startTime) {
    curRunTime = ((new Date()).getTime() - startTime.getTime());
  } else {
    curRunTime = 0;
  }

  return {
    status: status,
    timeTotal: lastTimeTaken,
    timeCur: curRunTime,
    fileRev: fileRevId,
    buildRev: buildRevId,
    auto: autoRebuild,
    aref: autoRefresh
  };
}

app.use('/__rebuild', function(req, res, next) {
  updateDocs();
  res.send(currentStatus());
});

app.use('/__toggleAuto', function(req, res, next) {
  autoRebuild = !autoRebuild;
  res.send(currentStatus());
});
app.use('/__toggleARef', function(req, res, next) {
  autoRefresh = !autoRefresh;
  res.send(currentStatus());
});

app.use('/__status', function(req, res, next) {
  res.send(currentStatus());
});

app.use(function(req, res, next) {
  if (req.path === '/') {
    return res.redirect('/topics/overview.html');
  }
  if (exitcode) {
    return res.send('<h1 style="color:#c30">Build Error</h1><pre>' + log + '</pre>');
  }
  if (!firstBuildDone) {
    return res.send('<h1 style="color:#c30">Building...</h1> Initial build is still in progress.  Please try again.');
  }

  var localPath = __dirname + '/temp' + req.path;

  var file = fs.createReadStream(localPath);

  file.on('data', function(chunk) {
    res.write(chunk);
  })
  file.on('error', function() {
    res.send(404);
  });
  file.on('end', function() {
    if (path.extname(req.path) === '.html') {
      res.write("\n\n" + '<script type="text/javascript">var initialStatus = ' + JSON.stringify(currentStatus()) + ';</script>');
      var ofile = fs.createReadStream(__dirname + '/overlay.html');
      ofile.pipe(res);
    } else {
      res.end();
    }
  });

});

app.listen(9096);
console.log('QuickView started!');
console.log('QuickView is listening at http://localhost:9096');
