import * as chrome from 'selenium-webdriver/chrome'
import {By, until, Builder, WebDriver, Locator, promise, logging, WebElement, Condition} from 'selenium-webdriver'

import {config, BenchmarkDriverOptions} from './common'

interface PathPart {
    tagName: string;
    index: number;
}

let useShadowRoot = false;

export function setUseShadowRoot(val: boolean) {
    useShadowRoot = val;
}

function convertPath(path: string): Array<PathPart> {
    let parts = path.split(/\//).filter(v => !!v);
    let res: Array<PathPart> = [];
    for (let part of parts) {
        let components = part.split(/\[|]/).filter(v => !!v);
        let tagName = components[0];
        let index:number = 0;
        if (components.length==2) {
            index = Number(components[1]);
            if (!index) {
                console.log("Index can't be parsed", components[1])
                throw "Index can't be parsed "+components[1];
            }
        } else {
            index = 1;
        }
        res.push({tagName, index});
    }
    return res;
}

// Fake findByXPath for simple XPath expressions to allow usage with shadow dom
async function findByXPath(node: WebElement, path: string): Promise<WebElement> {
     let paths = convertPath(path);
     let n = node;
     try {
        for (let p of paths) {
            // n = n.then(nd => nd.findElements(By.tagName(p.tagName))).then(elems => { // costly since it fetches all elements
           let elems = await n.findElements(By.css(p.tagName+":nth-child("+(p.index)+")"));
           if (elems==null || elems.length==0) { return null};
           n = elems[0];
        }
     } catch (e) {
         //can happen for StaleElementReferenceError
        return null;
     }
     return n;
}

function elemNull(v: any) {
    console.log("*** ELEMENT WAS NULL");
    return false;
}

function waitForCondition(driver: WebDriver) {
    return async function(text: string, fn: (driver:WebDriver) => Promise<boolean>, timeout: number): Promise<boolean> {
        return await driver.wait(new Condition<Promise<boolean>>(text, fn), timeout);
    }
}

// driver.findElement(By.xpath("//tbody/tr[1]/td[1]")).getText().then(...) can throw a stale element error:
// thus we're using a safer way here:
export async function testTextContains(driver: WebDriver, xpath: string, text: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testTextContains ${xpath} ${text}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await findByXPath(elem, xpath);
                if (elem==null) return false;
                let v = await elem.getText();
                return v && v.indexOf(text)>-1;
            } catch(err) {
                console.log("ignoring error in testTextContains for xpath = "+xpath+" text = "+text,err.toString().split("\n")[0]);
            }
        }, timeout);
}

export function testTextNotContained(driver: WebDriver, xpath: string, text: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testTextNotContained ${xpath} ${text}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await findByXPath(elem, xpath);
                if (elem==null) return false;
                let v = await elem.getText();
                return v && v.indexOf(text)==-1;
            } catch(err) {
                console.log("ignoring error in testTextNotContained for xpath = "+xpath+" text = "+text,err.toString().split("\n")[0])
            }
        }, timeout);
}

export function testClassContains(driver: WebDriver, xpath: string, text: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testClassContains ${xpath} ${text}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await findByXPath(elem, xpath);
                if (elem==null) return false;
                let v = await elem.getAttribute("class");
                return v && v.indexOf(text)>-1;
            } catch(err) {
                console.log("ignoring error in testClassContains for xpath = "+xpath+" text = "+text,err.toString().split("\n")[0])
            }
        }, timeout);
}

export function testElementLocatedByXpath(driver: WebDriver, xpath: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testElementLocatedByXpath ${xpath}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await findByXPath(elem, xpath);
                return elem ? true : false;
            } catch(err) {
                console.log("ignoring error in testElementLocatedByXpath for xpath = "+xpath,err.toString())
            }
        }, timeout);
}

export function testElementNotLocatedByXPath(driver: WebDriver, xpath: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testElementNotLocatedByXPath ${xpath}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await findByXPath(elem, xpath);
                return elem ? false : true;
            } catch(err) {
                console.log("ignoring error in testElementNotLocatedByXPath for xpath = "+xpath,err.toString().split("\n")[0]);
            }
    }, timeout);
}

export function testElementLocatedById(driver: WebDriver, id: string, timeout = config.TIMEOUT) {
    return waitForCondition(driver)(`testElementLocatedById ${id}`,
        async function(driver) {
            try {
                let elem = await shadowRoot(driver);
                elem = await elem.findElement(By.id(id));
                return true;
            } catch(err) {
                // console.log("ignoring error in testElementLocatedById for id = "+id,err.toString().split("\n")[0]);
            }
        }, timeout);
    }

async function retry<T>(retryCount: number, driver: WebDriver, fun : (driver:  WebDriver, retryCount: number) => Promise<T>):  Promise<T> {
    for (let i=0; i<retryCount; i++) {
        try {
            return fun(driver, i);
        } catch (err) {
            console.log("retry failed");
        }
    }
}

// Stale element prevention. For aurelia even after a testElementLocatedById clickElementById for the same id can fail
// No idea how that can be explained
export function clickElementById(driver: WebDriver, id: string) {
    return retry(5, driver, async function (driver) {
        let elem = await shadowRoot(driver);
        elem = await elem.findElement(By.id(id));
        await elem.click();
    });
}

export function clickElementByXPath(driver: WebDriver, xpath: string) {
    return retry(5, driver, async function(driver, count) {
        if (count>1 && config.LOG_DETAILS) console.log("clickElementByXPath ",xpath," attempt #",count);
        let elem = await shadowRoot(driver);
        elem = await findByXPath(elem, xpath);
        await  elem.click();
    });
    // Stale element possible:
    // return to(driver.findElement(By.xpath(xpath)).click());
}

export async function getTextByXPath(driver: WebDriver, xpath: string): Promise<string> {
    return await retry(5, driver, async function(driver, count) {
        if (count>1 && config.LOG_DETAILS) console.log("getTextByXPath ",xpath," attempt #",count);
        let elem = await shadowRoot(driver);
        elem = await findByXPath(elem, xpath);
        return await elem.getText();
    });
}

async function shadowRoot(driver: WebDriver) : Promise<WebElement> {
    return useShadowRoot ? await driver.executeScript('return document.querySelector("main-element").shadowRoot') as WebElement
        : await driver.findElement(By.tagName("body"));
}


export function buildDriver(benchmarkOptions: BenchmarkDriverOptions): WebDriver {
    let logPref = new logging.Preferences();
    logPref.setLevel(logging.Type.PERFORMANCE, logging.Level.ALL);
    logPref.setLevel(logging.Type.BROWSER, logging.Level.ALL);

    let options = new chrome.Options();
    options.setProxy(null);
    if(benchmarkOptions.headless) {
        options = options.addArguments("--headless");
        options = options.addArguments("--disable-gpu"); // https://bugs.chromium.org/p/chromium/issues/detail?id=737678
    }
    options = options.addArguments("--js-flags=--expose-gc");
    options = options.addArguments("--enable-precise-memory-info");
    options = options.addArguments("--no-sandbox");
    options = options.addArguments("--no-first-run");
    options = options.addArguments("--enable-automation");
    options = options.addArguments("--disable-infobars");
    options = options.addArguments("--disable-background-networking");
    options = options.addArguments("--disable-background-timer-throttling");
    options = options.addArguments("--disable-cache");
    options = options.addArguments("--disable-translate");
    options = options.addArguments("--disable-sync");
    options = options.addArguments("--disable-extensions");
    options = options.addArguments("--disable-default-apps");
    options = options.addArguments("--remote-debugging-port="+(benchmarkOptions.remoteDebuggingPort).toFixed());
    options = options.addArguments("--window-size=1200,800")
    if (benchmarkOptions.chromeBinaryPath) options = options.setChromeBinaryPath(benchmarkOptions.chromeBinaryPath);
    options = options.setLoggingPrefs(logPref) as chrome.Options;

    options = options.setPerfLoggingPrefs(<any>{
        enableNetwork: true, enablePage: true,
        traceCategories: 'devtools.timeline,blink.user_timing'
    });

    // Do the following lines really cause https://github.com/krausest/js-framework-benchmark/issues/303 ?
    // return chrome.Driver.createSession(options, service);
   console.time("chromedriver");
    let service = new chrome.ServiceBuilder().setPort(benchmarkOptions.chromePort).build();
    console.timeLog("chromedriver", "service created");
    var driver = chrome.Driver.createSession(options, service);
    console.timeLog("chromedriver", "driver created");
    // console.log("after service builder");
    // return new Builder()
    //     .forBrowser('chrome')
    //     .setChromeOptions(options)
    //     .build();

    return driver;
}