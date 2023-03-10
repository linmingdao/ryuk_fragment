const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const babel = require('@babel/core');

// npm i cli-highlight
// node bundler.js | highlight

// 模块分析器
const moduleAnalyser = (filename) => {
  const content = fs.readFileSync(filename, 'utf-8');
  const ast = parser.parse(content, { sourceType: 'module' });
  const dependencies = {};
  traverse(ast, {
    ImportDeclaration({ node }) {
      const dirname = path.dirname(filename);
      const newFile = './' + path.join(dirname, node.source.value);
      dependencies[node.source.value] = newFile;
    },
  });

  const { code } = babel.transformFromAst(ast, null, {
    presets: ['@babel/preset-env'],
  });

  return { filename, dependencies, code };
};

// const moduleInfo = moduleAnalyser('./src/index.js');
// console.log(moduleInfo);

// 分析依赖图谱
const makeDependenciesGraph = (entry) => {
  const entryModule = moduleAnalyser(entry);
  const graphArry = [entryModule];
  for (let i = 0; i < graphArry.length; i++) {
    const item = graphArry[i];
    const { dependencies } = item;
    if (dependencies) {
      for (let j in dependencies) {
        graphArry.push(moduleAnalyser(dependencies[j]));
      }
    }
  }

  const graph = {};
  graphArry.forEach((item) => {
    graph[item.filename] = { ...item };
  });

  return graph;
};

// const graphInfo = makeDependenciesGraph('./src/index.js');
// console.log(graphInfo);

// 代码生成器
const generateCode = (entry) => {
  const graph = JSON.stringify(makeDependenciesGraph(entry));
  // 防止全局变量污染，将代码放到闭包里执行
  return `(function(graph) {
    function require(module) {
      function localRequire(relativePath) {
        return require(graph[module].dependencies[relativePath]);
      }
      var exports = {};
      (function(require, exports, code) {
        eval(code);
      })(localRequire, exports, graph[module].code);
      return exports;
    }
    require('${entry}');
  })(${graph});`;
};

const code = generateCode('./src/index.js');
console.log(code);
