//this function runs each morning to notify all users of impending newsletter launches.
//each user has a customizable launch date and time which they can configure as early as
//the first Tuesday of the month at 12:00am, or as late as the following Monday night at
//11:45pm. 

import * as dynamoDbLib from "./libs/dynamodb-lib";
// import { findNextLE, getLaunchDateFromMonth } from "./libs/utils";
var ses = new aws.SES({
   region: 'us-west-2'
});

function getLaunchDateFromMonth(month) {
    //returns the first Tuesday of the given month as a Date object (at 10am zulu)...
    var date = new Date();
    date.setMonth(month);
    date.setDate(1);
    while(date.getDay() !== 2){
        date.setDate(date.getDate() + 1);
    }
    date.setHours(10,0,0,0);
    return date;
}



async function findNextLE(){
    // find soonest launch event (that isn't in the past) from array of launch events and return that object
    const params = {
        TableName: "launchEvents",
        ProjectionExpression: "launchDate, defaultNewsletter"
    };
    
    try{
        const currentDate = new Date();
        var outputEvent = null;
        return await dynamoDbLib.call("scan", params)
            .then((launchEvents) => {
                for( var i = 0; i < launchEvents.Items.length; i++ ){
                    const launchEvent = launchEvents.Items[i];
                    if(new Date(launchEvent.launchDate) >= currentDate){
                        if(outputEvent === null){
                            outputEvent = launchEvent;
                        } else if(new Date(launchEvent.launchDate) < new Date(outputEvent.launchDate)) {
                            outputEvent = launchEvent;
                        }
                    }
                }
                return outputEvent;
            })
    } catch (e) {
        console.log(e);
    }
}

export async function main(event, context, callback) { 
    //first, decide if this even needs to run today...
    const today = new Date();
    today.setHours(0,0,0,0);
    const fiveDaysHence = new Date();
    fiveDaysHence.setDate(today.getDate()+5);
    const thisMonth = today.getMonth();
    const thisMonthLaunchDay = getLaunchDateFromMonth(thisMonth).setHours(0,0,0,0);
    const nextMonthLaunchDay = getLaunchDateFromMonth(thisMonth+1).setHours(0,0,0,0);
    if(+today >= +thisMonthLaunchDay && +fiveDaysHence < +nextMonthLaunchDay){
        console.log("No impending launches...")
        return;
    }
    
    //build the params for the user table scan...
    const user_params = {
        TableName: "tr-users",
        ProjectionExpression: "firstName, lastName, userId, emailAddress, delayDays, delayTime"
    }

    //hit send on the email
    function sendEmail(params) {
        try {
        var email = ses.sendEmail(params, function(err, data){
            if(err) console.log(err);
            else {
                console.log("===EMAIL SENT===");
                console.log(data);
                console.log('EMAIL: ', email);
                // context.succeed(event);
            }
        });
    } catch (err) {
        console.log(err);
    }

    }
    try {
        //get the user table and the next launch event...
        const promises = [ await dynamoDbLib.call("scan", user_params) , await findNextLE() ];
        Promise.all(promises)
            .then((results) => {
                const userTable = results[0].Items;
                const launchDate = results[1].launchDate;
                //bake the launch date into each user object...
                userTable.forEach(user => {
                    var userLaunchDate = new Date(launchDate);
                    userLaunchDate.setDate( userLaunchDate.getDate() + (user.delayDays ? user.delayDays : 0) );
                    if(user.delayTime && user.delayTime !== "null") {
                        var zuluTime = new Date(userLaunchDate);
                        var pacificTime = new Date(zuluTime.toLocaleString("en-US",{timeZone: "America/Los_Angeles"}));
                        var offset = Math.round((zuluTime-pacificTime)/1000/60/60,0); //get the current pacific/zulu offset in hours...
                        userLaunchDate.setHours( (+user.delayTime.substring(0,2) + offset), user.delayTime.substring(2,5) );
                    }
                    user.launchDate = userLaunchDate;
                });
            
                userTable.forEach(user => {
                    
                    var today = new Date();
                    //set "today"'s time to match the user's launch date for easy, even comparisons...
                    today.setHours(user.launchDate.getHours(),user.launchDate.getMinutes(),user.launchDate.getSeconds(),user.launchDate.getMilliseconds());
                    var tMinus5 = new Date(user.launchDate);
                    tMinus5.setDate(user.launchDate.getDate()-5);
                    var tMinus3 = new Date(user.launchDate);
                    tMinus3.setDate(user.launchDate.getDate()-3);
                    var tMinus1 = new Date(user.launchDate);
                    tMinus1.setDate(user.launchDate.getDate()-1);
                    var eParams = {
                        Destination: {
                            ToAddresses: [user.emailAddress]
                        },
                        Message: {
                            Body: {
                                Html: {
                                    Charset: "UTF-8",
                                    Data: "" 
                                }
                            },
                            Subject: {
                                Data: ""
                            }
                        },
                        Source: "Support@TrustyRaven.com"
                    };
                    
                    if(today.toString() === tMinus5.toString()) {
                        //send the t-5 email...
                        eParams.Message.Body.Html.Data =
                            `Hi ${user.firstName},<br />` + 
                            `<br />` +
                            `Your Trusty Raven newsletter is scheduled to go out in five days, ` + 
                            `on ${user.launchDate.toLocaleDateString("en-US",{timeZone: "America/Los_Angeles"})} at ` +
                            `${user.launchDate.toLocaleTimeString("en-US",{timeZone: "America/Los_Angeles"})}. Please ` +
                            `<a href="https://trustyraven.com/login">login to your Trusty Raven account</a> if you would ` +
                            `like to preview or update your newsletter.<br />` +
                            `<br />` +
                            `Cheers,<br />` +
                            `The Trusty Raven Team`;
                        eParams.Message.Subject.Data = "Your newsletter will launch in 5 days..."

                        console.log("Sending tMinus5 email to: ", user.emailAddress);

                        sendEmail(eParams);
                        
                    }
                    if(today.toString() === tMinus3.toString()) {
                        //send the t-3 email...
                        eParams.Message.Body.Html.Data =
                            `Hi ${user.firstName},<br />` + 
                            `<br />` +
                            `Your Trusty Raven newsletter is scheduled to go out in three days, ` + 
                            `on ${user.launchDate.toLocaleDateString("en-US",{timeZone: "America/Los_Angeles"})} at ` +
                            `${user.launchDate.toLocaleTimeString("en-US",{timeZone: "America/Los_Angeles"})}. Please ` +
                            `<a href="https://trustyraven.com/login">login to your Trusty Raven account</a> if you would ` +
                            `like to preview or update your newsletter.<br />` +
                            `<br />` +
                            `Cheers,<br />` +
                            `The Trusty Raven Team`;
                        eParams.Message.Subject.Data = "Your newsletter will launch in 3 days..."

                        console.log("Sending tMinus3 email to: ", user.emailAddress);

                        sendEmail(eParams);
                    }
                    if(today.toString() === tMinus1.toString()) {
                        //send the t-1 email...
                        eParams.Message.Body.Html.Data =
                            `Hi ${user.firstName},<br />` + 
                            `<br />` +
                            `Your Trusty Raven newsletter is scheduled to go out tomorrow, ` + 
                            `at ` +
                            `${user.launchDate.toLocaleTimeString("en-US",{timeZone: "America/Los_Angeles"})}. Please ` +
                            `<a href="https://trustyraven.com/login">login to your Trusty Raven account</a> if you would ` +
                            `like to preview or update your newsletter.<br />` +
                            `<br />` +
                            `Cheers,<br />` +
                            `The Trusty Raven Team`;
                        eParams.Message.Subject.Data = "Your newsletter will launch TOMORROW..."

                        console.log("Sending tMinus1 email to: ", user.emailAddress);

                        sendEmail(eParams);
                    }
                })
            });
    } catch (err) {
        console.log("an error occured: ", err);
    }    

};
